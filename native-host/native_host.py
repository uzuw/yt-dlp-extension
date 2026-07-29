#!/usr/bin/env python3
"""
ytdlp-extension Native Messaging Host.
Protocol: 4-byte LE length prefix + JSON message on stdin, same on stdout.
Commands: list_formats, download, cancel. All logging to stderr.
"""
import json, os, re, struct, subprocess, sys, signal, shutil, threading

OUTPUT_DIR = os.path.expanduser("~/Downloads/ytdlp-extensions")
YTDLP_BIN = "yt-dlp"
_download_proc = None
_download_lock = threading.Lock()
_send_lock = threading.Lock()


def log(msg: str):
    print(f"[native_host] {msg}", file=sys.stderr, flush=True)


def read_message() -> dict | None:
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        return None
    length = struct.unpack("<I", raw)[0]
    payload = sys.stdin.buffer.read(length)
    if not payload:
        return None
    return json.loads(payload.decode("utf-8"))


def send_message(data: dict):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    with _send_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(body)))
        sys.stdout.buffer.write(body)
        sys.stdout.buffer.flush()


def _find_ytdlp() -> str:
    for c in [YTDLP_BIN, os.path.expanduser("~/.local/bin/yt-dlp")]:
        if shutil.which(c):
            return c
    raise FileNotFoundError("yt-dlp not found on PATH")


def handle_list_formats(url: str):
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        send_message({"type": "error", "message": "Invalid or missing URL"})
        return

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    try:
        result = subprocess.run(
            [_find_ytdlp(), "--no-warnings", "-J", url],
            capture_output=True, text=True, timeout=120, env=env,
        )
    except FileNotFoundError as e:
        send_message({"type": "error", "message": str(e)})
        return
    except subprocess.TimeoutExpired:
        send_message({"type": "error", "message": "Request timed out (120s)"})
        return

    if result.returncode != 0:
        msg = (result.stderr or result.stdout or "").strip()[:2000]
        send_message({"type": "error", "message": msg or f"Exit code {result.returncode}"})
        return

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        send_message({"type": "error", "message": "Failed to parse yt-dlp JSON output"})
        return

    title = data.get("title", "") or data.get("id", "Untitled")
    raw = data.get("formats") or data.get("requested_formats") or []

    seen = set()
    formats = []
    for f in raw:
        fid = f.get("format_id", "")
        dedup_key = (fid, f.get("height"), round(f.get("tbr") or 0))
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        vc = f.get("vcodec", "none")
        ac = f.get("acodec", "none")
        formats.append({
            "format_id": fid,
            "ext": f.get("ext", "?"),
            "width": f.get("width"),
            "height": f.get("height"),
            "filesize": f.get("filesize") or f.get("filesize_approx"),
            "tbr": round(f.get("tbr") or 0, 1) if f.get("tbr") else None,
            "vcodec": vc if vc and vc != "none" else None,
            "acodec": ac if ac and ac != "none" else None,
            "fps": f.get("fps"),
            "format_note": f.get("format_note", "") or "",
        })

    formats.sort(key=lambda x: (-(x["height"] or 0), -(x["tbr"] or 0)))

    has_v = any(f["vcodec"] for f in formats)
    has_a = any(f["acodec"] for f in formats)

    convenience = []
    if has_v and has_a:
        convenience.append({"format_id": "bv*+ba/b", "ext": "mp4", "width": None, "height": None,
                            "filesize": None, "tbr": None, "vcodec": "h264", "acodec": "aac",
                            "fps": None, "format_note": "Best video + audio"})
    if has_v:
        convenience.append({"format_id": "bv*", "ext": "mp4", "width": None, "height": None,
                            "filesize": None, "tbr": None, "vcodec": "h264", "acodec": None,
                            "fps": None, "format_note": "Best video only"})
    if has_a:
        convenience.append({"format_id": "ba*", "ext": "m4a", "width": None, "height": None,
                            "filesize": None, "tbr": None, "vcodec": None, "acodec": "aac",
                            "fps": None, "format_note": "Best audio only"})
    formats = convenience + formats

    send_message({
        "type": "formats",
        "title": title,
        "extractor": data.get("extractor_key", ""),
        "thumbnail": data.get("thumbnail") or "",
        "duration": data.get("duration"),
        "webpage_url": data.get("webpage_url") or url,
        "formats": formats,
    })


def _do_download(url: str, format_id: str):
    """Runs in a background thread. Reads yt-dlp output and sends progress."""
    global _download_proc
    fid = format_id or "bv*+ba/b"
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    template = os.path.join(OUTPUT_DIR, "%(title)s.%(ext)s")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    try:
        proc = subprocess.Popen(
            [_find_ytdlp(), "--no-warnings", "-f", fid, "-o", template, "--newline", "--no-colors", url],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=env,
        )
    except FileNotFoundError as e:
        send_message({"type": "error", "message": str(e)})
        return

    with _download_lock:
        _download_proc = proc

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip("\n")
        if not line:
            continue
        if "[download] Destination:" in line:
            fpath = line.split("Destination:", 1)[1].strip()
            send_message({"type": "filepath", "path": fpath})
            continue
        if "[download]" in line and "%" in line:
            m = re.search(r"(\d+(?:\.\d+)?)%", line)
            if m:
                pct = float(m.group(1))
                speed = ""
                s = re.search(r"at\s+(\d+(?:\.\d+)?\s*\w+iB/s)", line)
                if s:
                    speed = s.group(1)
                eta = ""
                e = re.search(r"(?:ETA|in)\s+(\d+(?::\d+)+)", line)
                if e:
                    eta = e.group(1)
                send_message({"type": "progress", "percent": pct, "speed": speed, "eta": eta})
                if pct >= 100:
                    break
                continue
        if line.startswith("[") and "]" in line:
            send_message({"type": "status", "text": line.strip()})

    rc = proc.wait()
    with _download_lock:
        _download_proc = None

    if rc == 0:
        send_message({"type": "done", "output_dir": OUTPUT_DIR})
    elif rc == -signal.SIGINT or rc == 255:
        send_message({"type": "canceled", "reason": "interrupted"})
    else:
        send_message({"type": "error", "message": f"Download failed (exit {rc})"})


def handle_download(url: str, format_id: str):
    """Start download in a background thread so main loop processes cancel."""
    t = threading.Thread(target=_do_download, args=(url, format_id), daemon=True)
    t.start()
    send_message({"type": "download_started"})


def handle_cancel():
    """Send SIGINT to the yt-dlp process. Thread detects exit and reports canceled."""
    with _download_lock:
        if _download_proc and _download_proc.poll() is None:
            _download_proc.send_signal(signal.SIGINT)


COMMANDS = {
    "list_formats": lambda m: handle_list_formats(m.get("url", "")),
    "download": lambda m: handle_download(m.get("url", ""), m.get("format_id", "")),
    "cancel": lambda _: handle_cancel(),
}


def main():
    log("Native host started (PID %d)" % os.getpid())
    try:
        while True:
            msg = read_message()
            if msg is None:
                break
            cmd = msg.get("command", "")
            log("Cmd: %s" % cmd)
            handler = COMMANDS.get(cmd)
            if handler:
                try:
                    handler(msg)
                except Exception as e:
                    log("Error: %s" % e)
                    send_message({"type": "error", "message": str(e)[:1000]})
            else:
                send_message({"type": "error", "message": "Unknown command: %s" % cmd})
    except KeyboardInterrupt:
        log("Shutting down")
    log("Exiting")


if __name__ == "__main__":
    main()
