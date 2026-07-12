# mod06-onedrive

Implement real OneDrive mutation activity (the OneDrive tab is currently a
scaffold). Reference: [OneDrive Graph API](https://learn.microsoft.com/en-us/graph/api/resources/onedrive?view=graph-rest-1.0)
and the `driveItem` [create-folder](https://learn.microsoft.com/graph/api/driveitem-post-children?view=graph-rest-1.0),
[update/move](https://learn.microsoft.com/graph/api/driveitem-move?view=graph-rest-1.0),
and [upload](https://learn.microsoft.com/graph/api/driveitem-put-content?view=graph-rest-1.0) methods.

Operations to support:

1. Create a new text file with a block of text from OpenRouter.
2. Create a new Word or PDF document with a block of text from OpenRouter.
3. Change the file name, but not extension, of an existing item.
4. Remove an existing item.
5. Create a new folder and move an existing item into it.
6. Choose a random image from Wikimedia and add it (in its native format) to a OneDrive folder.

## decisions

- **UI model:** weighted-random, like the Mail/Calendar tabs — one random operation
  per selected user per pass, driven by the `RunStepper` + **Do it now**. (Replaces the
  current `MutationPlaceholder` scaffold on `OneDrivePage.tsx`.)
- **Documents:** generate **both** `.docx` and `.pdf` (chosen 50/50), which means two new
  runtime dependencies: `docx` and `pdf-lib`.
- **Wikimedia image:** pull randomly from a **curated Commons category** (default
  `Category:Featured pictures on Wikimedia Commons`) with a size cap and an image-mime
  allowlist. Uploaded in its native format (original extension preserved).
- **Working location:** for each operation, discover the user's existing folders and pick
  one **at random** as the working folder; fall back to the drive root when the drive has
  no folders.

## Design

### Operation model

`onedrive-mutate.ts` mirrors `mail-mutate.ts`: a weighted pick per (user × pass), a
bounded worker pool (concurrency 5), and a capped result sample. Weights (sum 100):

| Op             | Weight | Needs an existing item? |
| -------------- | ------ | ----------------------- |
| `createText`   | 20     | no                      |
| `createDoc`    | 20     | no (Word/PDF 50/50)     |
| `rename`       | 10     | yes (a file)            |
| `createFolder` | 10     | no                      |
| `remove`       | 15     | yes (any item)          |
| `folderMove`   | 10     | yes (an item to move)   |
| `image`        | 15     | no                      |

Each op first resolves a **random working folder** for the user. Ops that need an existing
item then pick one at random from the drive. If a required item is missing (empty drive),
the op **falls back to `createText`** — the same pattern `mutateMail` uses when a mailbox
has no messages — so a pass never silently no-ops.

### Graph helpers (`src/graph/files.ts`)

Refactor the existing breadth-first walk in `listOneDriveItemsByDate` into a shared
internal walker, then add:

- `listOneDriveFolders(userId)` → `{ id, name }[]` — folders only (for random working-folder
  selection); capped by `MAX_ONEDRIVE_SCAN`.
- `listOneDriveFiles(userId, folderId?)` → `{ id, name }[]` — files, optionally within one
  folder (for rename/remove/move targets). Reuses `listOneDriveItemsByDate(userId, {})`.
- `createOneDriveFolder(userId, parentId, name)` — POST `…/items/{parentId}/children` with
  `{ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }`.
- `uploadOneDriveFileToFolder(userId, parentId, filename, content, contentType?)` — PUT
  `…/items/{parentId}:/{filename}:/content` (Graph infers content type from the extension;
  set the header when we have it). Generalizes the existing root-only `uploadOneDriveFile`.
- `renameOneDriveItem(userId, itemId, newName)` — PATCH `…/items/{itemId}` `{ name }`.
- `moveOneDriveItem(userId, itemId, newParentId)` — PATCH `…/items/{itemId}`
  `{ parentReference: { id: newParentId } }`. (We only ever move into a folder we just
  created, so the move-to-root "can't use id:root" caveat doesn't apply.)
- `deleteOneDriveFile` already exists (reused for `remove`).

Root as a working folder uses path addressing (`root:/{filename}:/content`) — no root ID
lookup needed.

### Document generation (`src/admin/doc-gen.ts`, new)

- `generatePdf(text)` via `pdf-lib` → `Uint8Array` (`application/pdf`, `.pdf`).
- `generateDocx(text)` via `docx` → `Buffer` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.docx`).
- `createDoc` picks one 50/50. Body text comes from `generateText(BODY_PROMPT)` (OpenRouter,
  with the existing GUID fallback when no key is set).

### Wikimedia image (`src/admin/wikimedia.ts`, new)

- MediaWiki API on `commons.wikimedia.org`: `list=categorymembers` (`cmtype=file`) to sample
  the curated category, then `prop=imageinfo` (`iiprop=url|mime|size`) for the pick.
- Enforce a **mime allowlist** (`image/jpeg|png|gif|webp|svg+xml`) and a **max size**
  (~8 MB); download bytes with `fetch` (Node 22) under a timeout. Return
  `{ buffer, filename, contentType }`, keeping the original extension. The op fails cleanly
  (logged, counted as a failure) if egress is blocked or nothing suitable is found.
- Category and limits are constants; category is overridable via config later if wanted.

### Naming

- New files: a short random base + correct extension (e.g. `mutator-3f9a2c11.pdf`);
  `@microsoft.graph.conflictBehavior: rename` avoids collisions.
- `rename` (op 3): split the existing name at the last `.`, replace the base with a new
  random base, and **keep the extension**. A pure `renameKeepingExtension(name, newBase)`
  helper is unit-tested.

### Route & frontend

- `POST /api/onedrive/mutate` in `admin-routes.ts`, mirroring `/api/mail/mutate`: resolve
  targets via `resolveTargetItems('onedrive', …)`, run `mutateOneDrive(items, runs)`,
  return the run plus `runStyle`/`pool`. Gated on saved `onedrive` targets (already wired
  through `TargetPanel`).
- `OneDrivePage.tsx`: replace `MutationPlaceholder` with a real mutate card (RunStepper +
  Do it now + results list), styled like `MailPage`/`CalendarPage`.
- Localize new `pages.onedrive.mutate.*` strings (op labels: createText, createDoc, rename,
  createFolder, remove, folderMove, image) in en/de/fr/nl/uk.

### Permissions

`Files.ReadWrite.All` only — already the OneDrive workload permission; no registration
change. The README permission table is unchanged.

### Tests (`src/admin/onedrive-mutate.test.ts`, `doc-gen.test.ts`)

- `pickOneDriveOp` weight distribution and range mapping (as in `mail-mutate.test.ts`).
- `mutateOne` falls back to `createText` when the drive has no existing item (mock Graph).
- `renameKeepingExtension` preserves the extension (and handles no-extension names).
- `generatePdf`/`generateDocx` emit non-empty output with the right magic bytes (`%PDF-`,
  `PK\x03\x04` zip header).
- Wikimedia response parsing + mime/size gating (mock `fetch`).

## Risks / open points

- **New dependencies:** `docx` and `pdf-lib` (both pure-JS, no native build). This is the
  main footprint change; everything else reuses existing patterns.
- **Outbound network:** op 6 requires the server to reach `commons.wikimedia.org`. It's
  bounded (timeout, size cap, mime allowlist) and fails gracefully, but it's the first
  feature that pulls external content into a tenant — worth a line in the README warning.
- **Content-type on upload:** relying on the extension is usually enough; we set the header
  for images/docs to be safe.
- **`remove` overlaps** with the mod05 Deletions tab. Here it's a single random delete as
  part of OneDrive activity (distinct from bulk date-scoped deletion), so it stays.
