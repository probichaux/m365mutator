# mod05-delete

The purpose of this function is to help test deleted item recovery and management by allowing programmatic deletion of a range of items in a workload.

## the Deletions page

1. Add a new tab to the nav bar called "Deletions"
2. On the deletions page,
  a. implement the same set of fields and controls for selecting users as the other pages
  b. include a way for the user to independently select mail, calendar, and/or OneDrive workloads
  c. include a way for the user to specify that they want the following selection patterns
    1. delete everything
    2. delete everything _after_ a specified date
    3. delete everything _before_ a specified date
    4. delete everything _between_ two dates

## Design (approved)

The page follows the "choice cards" mockup (`mockups/delete-2-cards.html`). It is a
top-to-bottom stack of four cards inside the standard app shell (header + nav + main):

1. **Users** — the standard `TargetPanel`, reused unchanged, on a new `deletions`
   target category so the Deletions user list is independent of the Mail/Calendar
   lists. Explicit/Random, Load/Upload/Check/Save all behave exactly as on the other
   pages. Random samples users who have a mailbox **or** OneDrive.
2. **Workloads** — three toggle cards (Mail / Calendar / OneDrive), each labelled with
   the official Microsoft product icon. Multi-select; at least one is required to run.
3. **What to delete** — four descriptive radio cards for the scope (Everything · After a
   date · Before a date · Between two dates). Date `<input type="date">` fields appear
   below and only for the modes that need them (one for after/before, two for between).
4. **Confirm & run** — a live, plain-English red summary of exactly what will be deleted,
   an "I understand this permanently deletes items" acknowledgement checkbox, and a
   red **Delete items** button. The button is disabled until the acknowledgement is
   checked, at least one workload is selected, and the user list is runnable (the same
   `onReadyChange` gate the other pages use). Results render below the card after a run,
   in the same style as the Mail/Calendar result lists.

### Scope semantics (approved)

- Items are matched by the date they arrived: **received date for mail**, **created
  date for calendar events and files**.
- Boundary dates are **inclusive** (on-or-after / on-or-before), interpreted in UTC:
  - `after D` → `date ge {D}T00:00:00Z`
  - `before D` → `date le {D}T23:59:59Z`
  - `between D1, D2` → `date ge {D1}T00:00:00Z and date le {D2}T23:59:59Z`
  - `all` → no date filter

### Deletion behaviour

Deletions are **soft** (recoverable), which is what "deleted item recovery" testing
needs: mail and calendar go to Deleted Items / recoverable items, OneDrive to the
recycle bin. Nothing is hard/permanently deleted.

- Mail: `DELETE /users/{id}/messages/{id}` (Mail.ReadWrite).
- Calendar: `DELETE /users/{id}/events/{id}` (Calendars.ReadWrite).
- OneDrive: `DELETE /users/{id}/drive/items/{id}` (Files.ReadWrite.All).

## Implementation

### Backend

- **`deletions` target category** — added to `TARGET_CATEGORIES`; `target-load` loads
  users with a mailbox or OneDrive; check/store flow through the existing UPN path.
- **Graph primitives** (`src/graph/`):
  - `mail.ts`: `listMessagesByDate(userId, range)`, `deleteMessage(userId, id)`.
  - `calendar.ts`: `listEventsByDate(userId, range)` (delete already present).
  - `files.ts`: `listOneDriveItemsByDate(userId, range)` — bounded recursive walk of the
    drive collecting files (delete already present).
- **`src/admin/deletion-mutate.ts`** — pure helpers `scopeToRange` and `buildDateFilter`
  (unit-tested), plus `mutateDeletions(users, workloads, scope, after?, before?)` which
  fans out over user × workload through a bounded worker pool, lists matches, and deletes
  them, returning per-pair results and totals (deleted / failed, with a capped sample).
- **Route** `POST /api/deletions/mutate` in `admin-routes.ts`, validating workloads,
  scope, and date shape, resolving users via `resolveTargetItems('deletions', …)`.

### Frontend

- `DeletionsPage.tsx`, registered in `App.tsx` (`PageId`/`PAGE_IDS`) and the nav.
- Official product icon SVGs under `client/public/icons/` (served at `/admin/icons/…`).
- All user-facing strings localized in en/de/fr/nl/uk (`nav`, `pages`, `targets`).
