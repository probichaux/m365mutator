# Changelog

All notable changes to M365Mutator are documented in this file.

## 0.6.7 — 2026-08-03

- Disable "Do it now" on every workload tab while the target list has unsaved edits (typed, loaded, or CSV-imported), with a warning explaining why. Previously a run would silently use the last saved list, not whatever was showing in the box, if you forgot to click Save targets.

## 0.6.6 — 2026-08-03

- Fix Mail's "Load" button silently overwriting the Calendar tab's saved target list. Each workload's targets are now fully independent — loading Mail's mailboxes from the tenant no longer touches Calendar's saved list.
- Show a live action-count preview (e.g. "3 passes × 6 targets = 18 actions") under each workload's Run button, so the actual scope of a run is visible before it fires.

## 0.6.5 — 2026-07-15

- Add real SharePoint mutation activity to the SharePoint tab (replacing the scaffold): one weighted-random action per selected site per pass — create a text file, create a Word or PDF document, rename a file, create a folder, remove a file, create a folder and move a file into it, or add a random image from Wikimedia Commons. Identical operations and weights to the OneDrive tab; actions target the site's default document library.
- The SharePoint Load button now streams site URLs progressively as Graph pages arrive, so the text field fills in without waiting for full pagination to complete.
- Display the app version in the header nav bar, next to the settings icon, as a link to the changelog on GitHub.
- Remove the 1,000-item hard cap on target lists; categories can now hold as many items as the tenant returns.

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
