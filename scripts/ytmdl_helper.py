#!/usr/bin/env python3
"""
PLAYD+ YouTube/Spotify helper for Express.
Reads a single JSON command from stdin, writes JSON result to stdout.

Commands:
  {"cmd": "search", "q": "<query>", "limit": 10}
  {"cmd": "stream", "videoId": "<id>"}
  {"cmd": "resolve-youtube-playlist", "url": "<playlist_url>", "max_items": 200}
  {"cmd": "resolve-spotify", "url": "<spotify_url>", "client_id": "...", "client_secret": "...", "max_items": 200}
"""

import sys
import json
import os
import subprocess
import re

# Hard cap on playlist/album items processed per request.
# The caller may supply a lower value; we never exceed this.
ABSOLUTE_MAX_ITEMS = 200


def ytdlp(args: list[str]) -> dict:
    """Run yt-dlp with args, return parsed JSON from stdout."""
    # Inject extractor-args to bypass YouTube's "Sign in to confirm you're not
    # a bot" check on server IPs. The android + web_safari + tv_embedded
    # clients use different player endpoints that don't require cookies.
    # yt-dlp silently ignores extractor-args for non-matching extractors,
    # so this is safe for Spotify/etc. calls too.
    base_args = [
        "--extractor-args",
        "youtube:player_client=android,web_safari,tv_embedded",
    ]
    result = subprocess.run(
        ["yt-dlp"] + base_args + args,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "yt-dlp exited with non-zero status")
    return result.stdout.strip()


def best_thumbnail(info: dict) -> str | None:
    """Pick the best non-storyboard thumbnail from yt-dlp info."""
    thumbs = info.get("thumbnails") or []
    real = [t for t in thumbs if "/sb/" not in (t.get("url") or "") and "i.ytimg.com/sb" not in (t.get("url") or "")]
    if real:
        real.sort(key=lambda t: (t.get("width") or t.get("preference") or 0), reverse=True)
        return real[0].get("url")
    return info.get("thumbnail")


def do_search(q: str, limit: int = 10) -> list[dict]:
    raw = ytdlp([
        f"ytsearch{limit}:{q}",
        "--dump-json",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
    ])
    tracks = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        info = json.loads(line)
        tracks.append({
            "videoId": info.get("id"),
            "title": info.get("title"),
            "artist": info.get("uploader") or info.get("channel"),
            "duration": info.get("duration"),
            "thumbnail": best_thumbnail(info),
        })
    return tracks


def do_stream(video_id: str) -> dict:
    yt_url = f"https://www.youtube.com/watch?v={video_id}"
    # Get metadata for title/duration/thumbnail
    meta_raw = ytdlp([
        yt_url,
        "--dump-json",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
    ])
    info = json.loads(meta_raw)
    # Get actual audio CDN/HLS URL via --get-url (reliable, no storyboard risk)
    stream_url = ytdlp([
        yt_url,
        "--get-url",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "-f", "bestaudio[ext=m4a]/bestaudio/best",
    ]).splitlines()[0].strip()
    return {
        "videoId": video_id,
        "streamUrl": stream_url,
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": best_thumbnail(info),
    }


def do_resolve_youtube_playlist(url: str, max_items: int = ABSOLUTE_MAX_ITEMS) -> list[dict]:
    cap = min(max_items, ABSOLUTE_MAX_ITEMS)
    raw = ytdlp([
        url,
        "--dump-json",
        "--yes-playlist",
        "--quiet",
        "--no-warnings",
        "--flat-playlist",
        # Limit the number of playlist entries fetched at the yt-dlp level.
        "--playlist-end", str(cap),
    ])
    tracks = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        if len(tracks) >= cap:
            break
        info = json.loads(line)
        video_id = info.get("id")
        tracks.append({
            "videoId": video_id,
            "title": info.get("title"),
            "artist": info.get("uploader") or info.get("channel"),
            "duration": info.get("duration"),
            "thumbnail": best_thumbnail(info),
        })
    return tracks


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

    # Detect URL type
    # Patterns: open.spotify.com/track/<id>, /playlist/<id>, /album/<id>
    match = re.search(r"spotify\.com/(track|playlist|album)/([A-Za-z0-9]+)", url)
    if not match:
        # Also handle spotify: URIs like spotify:track:xxx
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
        # Paginate only up to the cap — stop fetching once we have enough.
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
        if cmd == "search":
            q = cmd_data.get("q", "")
            limit = int(cmd_data.get("limit", 10))
            result = do_search(q, limit)
            print(json.dumps({"ok": True, "tracks": result}))

        elif cmd == "stream":
            video_id = cmd_data.get("videoId", "")
            result = do_stream(video_id)
            print(json.dumps({"ok": True, **result}))

        elif cmd == "resolve-youtube-playlist":
            url = cmd_data.get("url", "")
            result = do_resolve_youtube_playlist(url, max_items=max_items)
            print(json.dumps({"ok": True, "tracks": result}))

        elif cmd == "resolve-spotify":
            url = cmd_data.get("url", "")
            client_id = cmd_data.get("client_id", "")
            client_secret = cmd_data.get("client_secret", "")
            if not client_id or not client_secret:
                print(json.dumps({"error": "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required"}))
                sys.exit(0)
            result = do_resolve_spotify(url, client_id, client_secret, max_items=max_items)
            print(json.dumps({"ok": True, "tracks": result}))

        else:
            print(json.dumps({"error": f"Unknown command: {cmd}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
