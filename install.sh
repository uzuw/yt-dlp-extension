#!/usr/bin/env bash
set -euo pipefail

# ytdlp-extension installer
# Registers the Native Messaging Host and creates output directory

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.ytdlp.extension"
HOST_FILE="$SCRIPT_DIR/native-host/$HOST_NAME.json"

echo "==> Installing ytdlp-extension Native Messaging Host..."

# Determine Chrome's native messaging host directory
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    HOST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    # Also check Chromium
    CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
else
    echo "Unsupported OS: $OSTYPE"
    exit 1
fi

mkdir -p "$HOST_DIR"
echo "  Target: $HOST_DIR"

# Read the manifest template, substitute the path to point at the actual script
PYTHON_PATH=$(command -v python3 || echo "/usr/bin/python3")
cat > "$HOST_DIR/$HOST_NAME.json" <<JSONEOF
{
  "name": "$HOST_NAME",
  "description": "Native messaging host for ytdlp Chrome extension",
  "path": "$SCRIPT_DIR/native-host/native_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://jhcahmjmlekpjjedlmdcillgdcphhkif/"]
}
JSONEOF

echo "  Manifest written: $HOST_DIR/$HOST_NAME.json"

# Also install for Chromium if directory exists
if [[ -d "$CHROMIUM_DIR" ]]; then
    mkdir -p "$CHROMIUM_DIR"
    cp "$HOST_DIR/$HOST_NAME.json" "$CHROMIUM_DIR/$HOST_NAME.json"
    echo "  Also installed for Chromium"
fi

# Make native_host.py executable
chmod +x "$SCRIPT_DIR/native-host/native_host.py"
echo "  Made native_host.py executable"

# Create output directory
OUTPUT_DIR="$HOME/Downloads/ytdlp-extensions"
mkdir -p "$OUTPUT_DIR"
echo "  Output directory: $OUTPUT_DIR"

# Verify yt-dlp availability
if command -v yt-dlp &>/dev/null; then
    echo "  yt-dlp found: $(yt-dlp --version)"
else
    echo "  WARNING: yt-dlp not found. Install it: https://github.com/yt-dlp/yt-dlp"
fi

echo ""
echo "==> Installation complete!"
echo "    Next: Load the extension in Chrome:"
echo "    1. Open chrome://extensions"
echo "    2. Enable Developer mode"
echo "    3. Click 'Load unpacked'"
echo "    4. Select: $SCRIPT_DIR/extension"
echo ""
echo "    To debug:"
echo "    - Extension logs: chrome://extensions -> service worker -> Console"
echo "    - Native host logs: journalctl or check stderr"
echo "    - Popup logs: right-click extension icon -> Inspect popup"
