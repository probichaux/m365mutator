# M365Mutator

An admin console for logging into a Microsoft 365 tenant via Microsoft Graph
and mutating users, mail, calendar items, and OneDrive/SharePoint documents.

The admin UI has no login — anyone who can reach it can view/change Graph
config and drive Graph operations. Run it somewhere only trusted operators
can reach (localhost, an internal network, etc.).

## Structure

- `src/main.ts` — Express server entry point.
- `src/admin/` — admin API (config storage, Graph connectivity test) and its
  Vite/React client under `src/admin/client/`.
- `src/graph/` — Microsoft Graph authentication (`graph-auth.ts`, client secret
  or certificate) and per-area mutation modules (`users.ts`, `mail.ts`,
  `calendar.ts`, `files.ts`).
- `src/helpers/` — shared config and file-I/O helpers.

## Setup

1. Register an Entra ID app registration with the application (not delegated)
   permissions you need, admin-consented. See `.env.example` for the common set.
2. Copy `.env.example` to `.env` and fill in `GRAPH_CLIENT_ID`, `GRAPH_TENANT_ID`,
   and either `GRAPH_CLIENT_SECRET` or `GRAPH_CERTIFICATE_PATH`.
3. Install dependencies and run:

   ```
   npm install
   npm run dev
   ```

   The admin UI loads straight to the dashboard at `http://localhost:3700/admin`
   in production builds; during frontend development run
   `npm --prefix src/admin/client run dev` separately for hot reload (proxies
   `/api` to port 3700).

## Testing Graph credentials

The admin UI's Settings panel can verify a client secret or certificate
against Graph before saving. Credentials can also be entered there instead of
editing `.env`. Config, including Graph secrets stored as plaintext, is
persisted in `config.json` under the data directory (`M365MUTATOR_DATA_DIR`,
default `/data` or `~/.m365mutator-data`), which is created with owner-only
permissions (`0700` directory, `0600` file) — that filesystem permission is
the only protection on secrets since there is no admin password to encrypt
them with.
