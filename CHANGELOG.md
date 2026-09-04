# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-09-04

### Added
- **Auto-heal**: when a download fails, the native host checks PyPI for a newer
  yt-dlp release, auto-updates it, and retries the download once (at most once per
  6 hours; cooldown persisted in `~/.cache/ytdlp-extension/update-state.json`).
- `scripts/update-ytdlp.sh`: update yt-dlp manually, or install a weekly systemd
  user timer with `--install-timer`.
- Download failure messages now include the real yt-dlp `ERROR:` line plus an
  update hint, instead of a bare "Download failed (exit 1)".

### Fixed
- Downloads failing with "Download failed (exit 1)". Stale yt-dlp releases were
  rejected by YouTube's media CDN mid-download with `HTTP Error 403: Forbidden`
  (YouTube change, Jul-Aug 2026): format detection still worked, but actual
  downloads died. Resolved by updating yt-dlp to 2026.08.19+ (now automated).

### Changed
- README: new "Keeping yt-dlp up to date" section, dynamic PyPI version badge,
  Arch Linux (PEP 668) install notes, troubleshooting entry for download failures.

## [1.0.0] - 2026-07-30
- Initial release: detect the current tab URL, list available formats, download
  media via a yt-dlp native messaging host (Chrome Extension, Manifest V3).
