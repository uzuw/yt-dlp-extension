# Changelog

All notable changes to this project are documented in this file.

## [1.1.1] - 2026-11-04

### Fixed
- Keep reading yt-dlp output after a stream reaches 100%, so audio downloads,
  merging, and postprocessing errors are handled without blocking the output pipe.
- Update yt-dlp with its recommended YouTube challenge solver dependencies and
  enable an available Deno or Node runtime for both format lookup and downloads.
- Refresh dependencies and retry failed format lookups once, matching download recovery.
- Prefer the user-installed yt-dlp that the updater maintains over an older system binary.
- Show download worker crashes and native host disconnects as errors; keep failures
  available when reopening the popup, with update instructions and a working Retry.
- Avoid reconnecting the download port when a separate format lookup fails.

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
