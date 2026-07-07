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

## Entra ID app registration

M365Mutator signs in to Microsoft Graph as an application (app-only,
client-credentials flow) — there is no interactive user. You register one
Entra ID app in the target tenant, grant it admin-consented **application**
permissions for the workloads you want to mutate, and give it a client secret
or certificate.

> **Warning:** these are tenant-wide, high-privilege permissions —
> `User.ReadWrite.All` lets the app change any user in the tenant. Grant only
> the permissions for the tabs you will actually use, and protect the client
> secret or certificate like a root credential.

### 1. Create the registration

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com)
   with an account that can register apps and grant admin consent (Global
   Administrator, or Cloud Application Administrator plus Privileged Role
   Administrator).
2. Go to **Identity → Applications → App registrations → New registration**.
3. Give it a name, e.g. `M365Mutator`.
4. Under **Supported account types**, choose **Accounts in this organizational
   directory only** (single tenant).
5. Leave **Redirect URI** empty — app-only authentication needs no redirect.
6. Select **Register**.
7. On the **Overview** page, copy the **Application (client) ID** and
   **Directory (tenant) ID**; these are `GRAPH_CLIENT_ID` and `GRAPH_TENANT_ID`.

### 2. Add application permissions

Go to **API permissions → Add a permission → Microsoft Graph → Application
permissions** and add the permissions for the workloads you plan to use:

| Tab / workload | Graph application permission  |
| -------------- | ----------------------------- |
| Identities     | `User.ReadWrite.All`          |
| Mail           | `Mail.ReadWrite`, `Mail.Send` |
| Calendar       | `Calendars.ReadWrite`         |
| OneDrive       | `Files.ReadWrite.All`         |
| SharePoint     | `Sites.ReadWrite.All`         |

Each `*.ReadWrite.*` permission includes read access, so the **Load** and
**Check** buttons work without adding the read-only variants separately.

Then select **Grant admin consent for \<tenant\>** and confirm — the Status
column should show a green check for every permission. Without consent, Graph
calls fail with `Authorization_RequestDenied`.

### 3. Add a credential

Use **either** a client secret **or** a certificate.

Client secret (simplest):

1. Go to **Certificates & secrets → Client secrets → New client secret**.
2. Set a description and expiry, then **Add**.
3. Copy the secret **Value** immediately — it is shown only once. This is
   `GRAPH_CLIENT_SECRET`.

Certificate (recommended for production):

1. Upload the certificate's public key under **Certificates & secrets →
   Certificates → Upload certificate**.
2. Point `GRAPH_CERTIFICATE_PATH` at a local PEM file holding the certificate
   **and** its private key. Set `GRAPH_CERTIFICATE_PASSWORD` if the PEM is
   encrypted, and `GRAPH_SEND_CERTIFICATE_CHAIN=true` if your tenant requires
   subject name + issuer (SNI) authentication.

### 4. Supply the values to M365Mutator

Put the values into `.env` (see `.env.example`) or enter them in the admin
UI's **Settings** panel, which can verify them against Graph before saving:

```dotenv
GRAPH_CLIENT_ID=<Application (client) ID>
GRAPH_TENANT_ID=<Directory (tenant) ID>
GRAPH_CLIENT_SECRET=<client secret value>   # or set GRAPH_CERTIFICATE_PATH
```

## Setup

1. Create the Entra ID app registration and grant it the Graph permissions you
   need — see [Entra ID app registration](#entra-id-app-registration) above.
2. Copy `.env.example` to `.env` and fill in `GRAPH_CLIENT_ID`, `GRAPH_TENANT_ID`,
   and either `GRAPH_CLIENT_SECRET` or `GRAPH_CERTIFICATE_PATH`.
3. Install dependencies and run:

   ```bash
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
