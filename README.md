# Familye — אונזער משפחה

Yiddish / RTL app for the Bochner (באכנער, father's side) and Biderman (בידערמאן, mother's side) families. The original approved design is preserved in `prototype/index.html`.

## Implemented

- PostgreSQL-backed accounts and records; no sample family information in the real app.
- Password sign-in, server sessions, logout, and single-use invitations expiring after seven days. An administrator assigns access to the father's side, mother's side, or both. Side access is checked on the server, including downloads and learning/RSVP endpoints.
- Responsive Yiddish / RTL navigation and dashboard showing saved records and upcoming simchas.
- Cousins directory: husband/wife, addresses, phones, parent names, search, CSV export, edit and delete. Members edit records they created; administrators can manage all records they can access.
- Family trees with parent/child relationships, spouse names, deceased markers, and cycle prevention. Tree changes are serialized in database transactions and parent references are enforced by a foreign key.
- Yahrzeits with entered Hebrew day/month, relationship and grave/location.
- Learning campaigns: 150 Tehillim chapters or 63 Mishnayos tractates, deadline, exclusive claims, release and completion. Database uniqueness prevents two users claiming the same section.
- Simchas: date/time, host, venue/address, Google Maps/Waze links, saved yes/no RSVPs, invitation upload/download (PNG/JPEG/PDF, up to 5 MB).
- Side-specific and shared chat, persisted and refreshed every ten seconds. Shows the latest 100 messages.
- Optimistic edit version checks, validation, ownership checks, request-origin checks, rate limits and content security headers.
- Docker/Compose deployment and CI against PostgreSQL 17.

## Deferred / not connected

- **SMS:** intentionally deferred. There are no fake phone codes or SMS delivery claims. Members currently receive an invitation link manually and choose a login/password.
- Annual Hebrew/Gregorian yahrzeit calculation, Adar/short-month policies and scheduled reminders. Entered Hebrew dates are displayed without guessed Gregorian dates.
- Push notifications, live sockets, automatic invitations/notifications, password recovery and member access administration. No email provider is configured.
- Couple relationships are stored as spouse text; this version has one parent/household link per tree entry rather than a full genealogical relationship model.
- Uploads are stored in PostgreSQL and downloaded as attachments; no virus scanning, object storage or inline PDF preview.
- Chat history pagination beyond the newest 100 messages.

## Run with Docker

1. Copy `.env.example` to `.env` and replace both passwords. Use URL-safe alphanumeric database passwords in Compose, since the password is part of `DATABASE_URL`.
2. For localhost, leave `APP_ORIGIN=http://localhost:3000` and `NODE_ENV=development`.
3. Run `docker compose up --build -d`.
4. Open `http://localhost:3000` and log in with `ADMIN_LOGIN` / `ADMIN_PASSWORD`.
5. In **אינווייטס**, choose the correct sides, generate a link, and send it to the cousin. Each link can create exactly one account. The raw link is shown once; generate another if it is lost.

The bootstrap admin is created only when its login does not exist. Changing bootstrap environment variables does **not** reset an existing user's password or elevate an existing user. Remove `ADMIN_PASSWORD` and `ADMIN_LOGIN` after first setup. Data and uploads persist in `familye-db`; do not delete the volume to update the application.

### Production / Coolify

Use a separate application and PostgreSQL database for Familye. Build this Dockerfile or use Compose, place it behind HTTPS, set `NODE_ENV=production`, `APP_ORIGIN=https://your-family-domain` (origin only, no trailing slash), and a private `DATABASE_URL`. The app listens on port 3000 and `/health/ready` checks the database. Restrict network access to PostgreSQL and back up the database volume, which also contains invitation files.

By default the app does not trust forwarded IP headers. If it is reachable **only** through a single trusted reverse proxy, set `TRUST_PROXY_HOPS=1` to apply rate limits per visitor rather than per proxy. Never expose the application directly when trusting forwarded headers.

The GitHub repository is public. Keep credentials and actual family information out of source, issues, screenshots and committed fixtures. Application records are held in the deployed database, not the repository.

No live deployment is created by this code change. A deployment host/domain and database must be configured before live browser acceptance.

## Development and checks

Node 22+ (CI and container use Node 24), PostgreSQL 17.

```sh
npm ci
# Set DATABASE_URL, APP_ORIGIN, ADMIN_LOGIN, ADMIN_NAME and ADMIN_PASSWORD in your shell.
# npm does not load .env automatically; Docker Compose does.
npm run dev
```

```sh
npm run check
node --check public/app.js
npm test
npm run build
```

Without `TEST_DATABASE_URL`, tests run on isolated in-memory PGlite (PostgreSQL engine in WASM). CI supplies a dedicated PostgreSQL database, which must be empty/disposable. Tests cover authorization, invitation reuse/expiry/revocation, persistence across app instances, stale writes, concurrent learning claims, invalid tree relationships, uploads/downloads, RSVP changes, chat boundaries and logout.

Database migrations are idempotent and run under a PostgreSQL advisory transaction lock on startup. Tree mutations use a separate advisory transaction lock. Real production browser/device acceptance remains a deployment step; automated HTTP tests do not establish visual or touch usability.
