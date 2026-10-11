# Changelog

All notable changes to M365Mutator are documented in this file.

## Unreleased

- Add message sizing to the Mail tab: a body size in KB of locally generated text, a random-data attachment in MB on each new message (sent through a Graph upload session above 3 MB), and a daily growth cap in GB (default 1 GB, matching Microsoft's supported growth rate for auto-expanding archives).
- Run mail mutations as background jobs: a run keeps going when you leave the Mail tab, the tab reconnects to it with live progress, and a Stop button ends it early.
- Skip meeting requests, delivery reports, and other items that can't take a reply when picking a message to reply to or forward.
- Add a continuous mode to the Mail tab: it runs until stopped, pauses at the daily cap until midnight, and ends on its own after 25 failures in a row.
- Track throttling (429, 503, and 504 responses) from Graph and attachment uploads, retry up to 10 times, and show throttling on the Mail tab and in a status line written to the log every 10 minutes.

## 0.4.0 — 2026-07-10

- Add Dutch and French localizations for the admin UI.

## 0.3.1 - 2026-07-09

- Updated the readme with new screenshots and some clarifying text
- Fixed a couple of minor UX issues

## 0.3.0 — 2026-07-08

- Remove the per-page Enabled/Disabled toggle; each workload tab is self-contained now.
- Keep each tab's "Do it now" action disabled until targets are loaded and saved, with a tooltip explaining what to do.

## 0.2.1 — 2026-07-08

- Fix the Targets "Load" button returning no mailboxes or sites in CDX/demo tenants, where service plans report as `Suspended` rather than `Enabled`.

## 0.2.0 — 2026-07-07

- Initial support for mutating calendar items.

## 0.1.2 — 2026-07-07

- Add an "Allow deletions" toggle to the mail mutation (off by default); when off, the move-to-Deleted-Items share goes to new messages.

## 0.1.1 — 2026-07-07

- Minor change to the OpenRouter text-generation prompt.

## 0.1.0 — 2026-07-07

- Initial public release.
