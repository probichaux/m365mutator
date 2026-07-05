# M365Mutator

An admin console for logging into a Microsoft 365 tenant via Microsoft Graph
and mutating users, mail, calendar items, and OneDrive/SharePoint documents.

## Structure

- `src/main.ts` — Express server entry point.
- `src/admin/` — password-gated admin API (login, encrypted config storage,
  Graph connectivity test) and its Vite/React client under `src/admin/client/`.
- `src/graph/` — Microsoft Graph authentication (`graph-auth.ts`, client secret
  or certificate) and per-area mutation modules (`users.ts`, `mail.ts`,
  `calendar.ts`, `files.ts`).
- `src/helpers/` — shared config and file-I/O helpers.

## Setup

1. Register an Entra ID app registration with the application (not delegated)
   permissions you need, admin-consented. See `.env.example` for the common set.
2. Copy `.env.example` to `.env` and fill in `GRAPH_CLIENT_ID`, `GRAPH_TENANT_ID`,
   and either `GRAPH_CLIENT_SECRET` or `GRAPH_CERTIFICATE_PATH`.
3. Set `M365MUTATOR_ADMIN_PASSWORD` to enable the admin UI at `/admin`, where
   credentials can also be entered and tested without editing `.env`.
4. Install dependencies and run:

   ```
   npm install
   npm run dev
   ```

   The admin UI is served at `http://localhost:3700/admin` in production
   builds; during frontend development run `npm --prefix src/admin/client run dev`
   separately for hot reload (proxies `/api` to port 3700).

## Testing Graph credentials

The admin UI's Settings panel can verify a client secret or certificate
against Graph before saving. Secrets are encrypted at rest (AES-256-GCM,
keyed from `M365MUTATOR_ADMIN_PASSWORD`) in `config.json` under the data
directory (`M365MUTATOR_DATA_DIR`, default `/data` or `~/.m365mutator-data`).
