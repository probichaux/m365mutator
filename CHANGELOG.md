# Changelog

All notable changes to M365Mutator are documented in this file.

## 0.7.0 — 2026-07-15

- Add real SharePoint mutation activity to the SharePoint tab (replacing the scaffold): one weighted-random action per selected site per pass — create a text file, create a Word or PDF document, rename a file, create a folder, remove a file, create a folder and move a file into it, or add a random image from Wikimedia Commons. Identical operations and weights to the OneDrive tab; actions target the site's default document library.
- The SharePoint Load button now streams site URLs progressively as Graph pages arrive, so the text field fills in without waiting for full pagination to complete.

## 0.6.0 — 2026-07-12

- Add real OneDrive mutation activity to the OneDrive tab (replacing the scaffold): one weighted-random action per selected user per pass — create a text file, create a Word or PDF document, rename a file (keeping its extension), create a folder, remove a file, create a folder and move a file into it, or add a random image from Wikimedia Commons.
- Each action targets a random existing folder in the user's drive (the root when there are none); document and text content come from OpenRouter when a key is configured.

## 0.5.0 — 2026-07-12

- Add a **Deletions** tab: select users (explicit list or a random tenant sample), pick the Mail, Calendar, and/or OneDrive workloads, and delete a date-scoped range of items to test deleted-item recovery and retention.
- Scope the deletion to everything, before a date, after a date, or between two dates (boundary dates inclusive); items match on the date they arrived — received date for mail, created date for calendar events and files.
- Deletions are soft/recoverable (Deleted Items / recycle bin) and gated behind an explicit acknowledgement.

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
