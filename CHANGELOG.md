# Changelog

## Unreleased

- Limit format lookup to 30 seconds, with a separate host connection and a timeout fallback.
- Avoid dependency updates during format lookup; select only the video on links with playlist parameters.
- Remove the dotted popup strip, outdated screenshot, and generated cache; simplify documentation.

## 1.1.1 — 2026-11-04

- Continue reading download output through audio downloads and merging.
- Update yt-dlp with its YouTube solver dependencies and detect Deno or Node.
- Prefer the user-installed yt-dlp maintained by the updater.
- Retry failed format lookups after refreshing dependencies.
- Show worker crashes and host disconnects, retain download errors, and keep Retry usable.
- Keep format lookup failures from disconnecting active downloads.

## 1.1.0 — 2026-09-04

- Add automatic yt-dlp updates and one download retry, with a six-hour cooldown.
- Add a manual update script and an optional weekly systemd timer.
- Show yt-dlp errors and update instructions when downloads fail.

## 1.0.0 — 2026-07-30

- Initial release: format selection, local downloads, progress, cancellation, and notifications.
