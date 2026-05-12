#!/usr/bin/env python3
"""
PLAYD+ Spotify helper for Express.
Reads a single JSON command from stdin, writes JSON result to stdout.

Commands:
  {"cmd": "resolve-spotify", "url": "<spotify_url>", "client_id": "...", "client_secret": "...", "max_items": 200}

YouTube extraction has been moved to youtubei.js (lib/youtube.ts).
The yt-dlp code is kept only for Spotify YouTube search fallback.
"""

import sys
import json
import os
import subprocess
import re
import tempfile
import atexit

# If YT_COOKIES_TXT is set (Netscape-format cookies.txt contents), write it
# to a temp file once at startup and pass --cookies to every yt-dlp call.
_COOKIES_FILE_PATH: str | None = None


def _cookies_file() -> str | None:
    global _COOKIES_FILE_PATH
    if _COOKIES_FILE_PATH is not None:
        return _COOKIES_FILE_PATH or None
    raw = os.environ.get("YT_COOKIES_TXT")
    if not raw:
        _COOKIES_FILE_PATH = ""
        return None
    # Env-variable input with tabs but no newlines means the Netscape
    # cookies file was flattened into a single line (Replit / some
    # secret-stores strip literal newlines but preserve tabs).
    #
    # Reconstruct line boundaries by detecting cookie-line starts:
    #   <domain>\t<TRUE|FALSE>\t...
    # When two cookie lines are concatenated the boundary looks like:
    #   <end-of-value-char> <space> <domain>\t<TRUE|FALSE>\t
    if "\t" in raw and "\n" not in raw:
        raw = re.sub(r"([^\t#])\s+([\w.-]+)\t(TRUE|FALSE)\t", r"\1\n\2\t\3\t", raw)
    if not raw.endswith("\n"):
        raw += "\n"
    fd, path = tempfile.mkstemp(prefix="yt_cookies_", suffix=".txt")
    with os.fdopen(fd, "w") as f:
        f.write(raw)
    os.chmod(path, 0o600)
    atexit.register(lambda p=path: os.path.exists(p) and os.remove(p))
    _COOKIES_FILE_PATH = path
    return path


ABSOLUTE_MAX_ITEMS = 200


_PYLIBS_SITE = "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages"
_PYLIBS_PY = "/home/runner/workspace/.pythonlibs/bin/python3"


def _ytdlp_cmd() -> tuple[list[str], dict[str, str]]:
    """Return (argv-prefix, env-overrides) for invoking the freshest yt-dlp."""
    if os.path.isdir(os.path.join(_PYLIBS_SITE, "yt_dlp")) and os.path.isfile(_PYLIBS_PY):
        env = os.environ.copy()
        env["PYTHONPATH"] = _PYLIBS_SITE + os.pathsep + env.get("PYTHONPATH", "")
        return [_PYLIBS_PY, "-m", "yt_dlp"], env
    return ["yt-dlp"], os.environ.copy()


def ytdlp(args: list[str]) -> str:
    """Run yt-dlp with args, return stdout."""
    cookies_path = _cookies_file()
    if cookies_path:
        base_args = [
            "--extractor-args", "youtube:player_client=web,mweb",
            "--cookies", cookies_path,
        ]
    else:
        base_args = [
            "--extractor-args", "youtube:player_client=tv_embedded,web_safari,mweb",
        ]
    cmd_prefix, env = _ytdlp_cmd()
    result = subprocess.run(
        cmd_prefix + base_args + args,
        capture_output=True,
        text=True,
        timeout=60,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "yt-dlp exited with non-zero status")
    return result.stdout.strip()


def spotify_search_yt(query: str) -> str | None:
    """Use yt-dlp to find a videoId for a Spotify track by searching YouTube."""
    try:
        raw = ytdlp([
            f"ytsearch1:{query}",
            "--dump-json",
            "--no-playlist",
            "--quiet",
            "--no-warnings",
        ])
        for line in raw.splitlines():
            if line.strip():
                info = json.loads(line)
                return info.get("id")
    except Exception:
        pass
    return None


def do_resolve_spotify(url: str, client_id: str, client_secret: str, max_items: int = ABSOLUTE_MAX_ITEMS) -> list[dict]:
    try:
        import spotipy
        from spotipy.oauth2 import SpotifyClientCredentials
    except ImportError:
        raise RuntimeError("spotipy is not installed. Run: pip install spotipy")

    cap = min(max_items, ABSOLUTE_MAX_ITEMS)

    sp = spotipy.Spotify(auth_manager=SpotifyClientCredentials(
        client_id=client_id,
        client_secret=client_secret,
    ))

    match = re.search(r"spotify\.com/(track|playlist|album)/([A-Za-z0-9]+)", url)
    if not match:
        match = re.search(r"spotify:(track|playlist|album):([A-Za-z0-9]+)", url)
    if not match:
        raise ValueError(f"Unrecognized Spotify URL format: {url}")

    kind = match.group(1)
    spotify_id = match.group(2)

    raw_tracks = []

    if kind == "track":
        t = sp.track(spotify_id)
        raw_tracks = [t]

    elif kind == "playlist":
        results = sp.playlist_items(spotify_id, additional_types=["track"], limit=min(cap, 100))
        items = results["items"]
        while results.get("next") and len(items) < cap:
            results = sp.next(results)
            items.extend(results["items"])
        raw_tracks = [item["track"] for item in items[:cap] if item.get("track")]

    elif kind == "album":
        results = sp.album_tracks(spotify_id, limit=min(cap, 50))
        items = results["items"]
        while results.get("next") and len(items) < cap:
            results = sp.next(results)
            items.extend(results["items"])
        raw_tracks = items[:cap]

    tracks = []
    for t in raw_tracks:
        if not t:
            continue
        name = t.get("name", "")
        artists = ", ".join(a["name"] for a in (t.get("artists") or []))
        duration_ms = t.get("duration_ms")
        duration_s = round(duration_ms / 1000) if duration_ms else None

        query = f"{artists} - {name}" if artists else name
        video_id = spotify_search_yt(query)

        tracks.append({
            "videoId": video_id,
            "title": name,
            "artist": artists,
            "duration": duration_s,
            "thumbnail": None,
            "spotifyId": t.get("id"),
        })

    return tracks


def main():
    raw = sys.stdin.read()
    try:
        cmd_data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    cmd = cmd_data.get("cmd")
    max_items = int(cmd_data.get("max_items", ABSOLUTE_MAX_ITEMS))

    try:
        if cmd == "resolve-spotify":
            url = cmd_data.get("url", "")
            client_id = cmd_data.get("client_id", "")
            client_secret = cmd_data.get("client_secret", "")
            if not client_id or not client_secret:
                print(json.dumps({"error": "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required"}))
                sys.exit(0)
            result = do_resolve_spotify(url, client_id, client_secret, max_items=max_items)
            print(json.dumps({"ok": True, "tracks": result}))
        else:
            print(json.dumps({"error": f"Unknown command: {cmd}. Only 'resolve-spotify' is supported."}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
