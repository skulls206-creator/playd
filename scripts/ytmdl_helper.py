#!/usr/bin/env python3
"""
PLAYD+ YouTube/Spotify helper for Express.
Reads a single JSON command from stdin, writes JSON result to stdout.

Commands:
  {"cmd": "search", "q": "<query>", "limit": 10}
  {"cmd": "stream", "videoId": "<id>"}
  {"cmd": "resolve-youtube-playlist", "url": "<playlist_url>"}
  {"cmd": "resolve-spotify", "url": "<spotify_url>", "client_id": "...", "client_secret": "..."}
"""

import sys
import json
import os
import subprocess
import re


def ytdlp(args: list[str]) -> dict:
    """Run yt-dlp with args, return parsed JSON from stdout."""
    result = subprocess.run(
        ["yt-dlp"] + args,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "yt-dlp exited with non-zero status")
    return result.stdout.strip()


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
            "thumbnail": (info.get("thumbnails") or [{}])[-1].get("url") if info.get("thumbnails") else info.get("thumbnail"),
        })
    return tracks


def do_stream(video_id: str) -> dict:
    raw = ytdlp([
        f"https://www.youtube.com/watch?v={video_id}",
        "--dump-json",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "-f", "bestaudio/best",
    ])
    info = json.loads(raw)
    # Find the best audio format URL
    url = None
    formats = info.get("formats", [])
    # prefer audio-only formats
    audio_formats = [f for f in formats if f.get("vcodec") == "none" and f.get("url")]
    if audio_formats:
        audio_formats.sort(key=lambda f: f.get("tbr") or 0, reverse=True)
        url = audio_formats[0]["url"]
    else:
        # fallback to any format with a url
        for f in reversed(formats):
            if f.get("url"):
                url = f["url"]
                break
    if not url:
        url = info.get("url")
    return {
        "videoId": video_id,
        "streamUrl": url,
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": (info.get("thumbnails") or [{}])[-1].get("url") if info.get("thumbnails") else info.get("thumbnail"),
    }


def do_resolve_youtube_playlist(url: str) -> list[dict]:
    raw = ytdlp([
        url,
        "--dump-json",
        "--yes-playlist",
        "--quiet",
        "--no-warnings",
        "--flat-playlist",
    ])
    tracks = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        info = json.loads(line)
        video_id = info.get("id")
        tracks.append({
            "videoId": video_id,
            "title": info.get("title"),
            "artist": info.get("uploader") or info.get("channel"),
            "duration": info.get("duration"),
            "thumbnail": (info.get("thumbnails") or [{}])[-1].get("url") if info.get("thumbnails") else info.get("thumbnail"),
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


def do_resolve_spotify(url: str, client_id: str, client_secret: str) -> list[dict]:
    try:
        import spotipy
        from spotipy.oauth2 import SpotifyClientCredentials
    except ImportError:
        raise RuntimeError("spotipy is not installed. Run: pip install spotipy")

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
        results = sp.playlist_items(spotify_id, additional_types=["track"])
        items = results["items"]
        while results.get("next"):
            results = sp.next(results)
            items.extend(results["items"])
        raw_tracks = [item["track"] for item in items if item.get("track")]

    elif kind == "album":
        results = sp.album_tracks(spotify_id)
        items = results["items"]
        while results.get("next"):
            results = sp.next(results)
            items.extend(results["items"])
        # album tracks don't have full artist info inline but have artists list
        raw_tracks = items

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
            result = do_resolve_youtube_playlist(url)
            print(json.dumps({"ok": True, "tracks": result}))

        elif cmd == "resolve-spotify":
            url = cmd_data.get("url", "")
            client_id = cmd_data.get("client_id", "")
            client_secret = cmd_data.get("client_secret", "")
            if not client_id or not client_secret:
                print(json.dumps({"error": "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required"}))
                sys.exit(0)
            result = do_resolve_spotify(url, client_id, client_secret)
            print(json.dumps({"ok": True, "tracks": result}))

        else:
            print(json.dumps({"error": f"Unknown command: {cmd}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
