# Changelog

All notable changes to M365Mutator are documented in this file.

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
