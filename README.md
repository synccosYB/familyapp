# Familye — Yiddish extended-family app

A members-only family app in today's heimish Yiddish (right-to-left), for the cousins of two sides of a family.
Live: https://familye.sites.tab.bot/ (Bochner / Biderman — באכנער / בידערמאן).
`prototype/index.html` is the approved clickable mockup (made-up data, nothing saved): https://familye-proto.sites.tab.bot/

## What it does
- **Sign up / log in**: name, phone, password, and which side you are a cousin on (father's, mother's, or both).
  New cousins wait for an admin to approve them. No SMS provider needed.
- **My account**: edit name/email, change password, and change the login phone after confirming the current password.
  Phone changes reject an occupied number, retain the current browser session, and expire other sessions and unused
  recovery links. SMS verification is not connected. The configured owner's identity stays attached to the same
  user record across phone changes and restarts.
- **Admin** (🛡️): approve / reject, change a member's side(s), make others admin, one-time "set password" link for a
  member who forgot (opens WhatsApp with the link), edit the family name and the two side names.
- **Yahrzeits** (🕯️): name + father's name, relation, side, Hebrew day + month (Adar / Adar I / Adar II), optional year,
  kever. This year's Gregorian date and "in N days" are computed with `@hebcal/core` (`HebrewCalendar.getYahrzeit`,
  so 30 Cheshvan/Kislev and Adar follow hebcal's rules). "Remind me" is stored per member (no messages are sent yet).
- **Family tree** (🌳): one tree per side, people with spouse, parent link, niftar mark; tree view and list view.
- **Mishnayos & Tehillim** (📖): a list l'ilui nishmas, with a target date (defaults to the next yahrzeit):
  all 150 kapitlach or all 63 masechtos. Tap to take, tap again to mark done or give back; nobody can take what
  someone else holds (checked atomically in the database). Progress bars.
- **Simchas** (🎉): type, whose, date (Hebrew date computed or typed), time, hall, address with Google Maps / Waze
  buttons, invite one side or everyone, one-tap RSVP with number of people and who's coming, invitation upload
  (JPG/PNG/WebP/GIF/HEIC or PDF, max 10 MB, type checked by its bytes), view full size, download; "mazel tov" posts to chat.
- **Cousins directory** (👥): husband + wife, whose child, side, address (Maps/Waze), phones (tap to call), search,
  side filter, add, edit your own, CSV download with a UTF-8 BOM (Excel shows the Yiddish).
  Address fields are separate street, apartment/unit, city, state/province, postal code and country. All are
  optional. Existing free-text addresses are retained; maps and exports use the formatted full address.
- **Chat** (💬): one group per side + one for all cousins; you only see the groups of your side(s). Polls every 3 s.
- **Home**: next yahrzeits, learning lists, upcoming simchas, latest messages.

Visibility: a member sees the items of his/her own side(s) plus everything marked "both"/"all". Admins see everything.

## Structured family records

Family tree people are the shared source for the directory and linked yahrzeits. Each person has a separate title, name, father, mother, spouse, life status (unknown / living / deceased), and optional Hebrew day, month and year of passing. Select existing people for relationships; a spouse link is reciprocal. A complete known day/month creates one linked yahrzeit; its Edit button opens the person record. Unknown dates do not create calendar entries.

In the directory, link the husband and wife to their existing tree records. Names and parents then follow edits in the tree. Household contact information stays on the household. Family-side visibility applies to every link. The API rejects ancestry cycles, conflicting spouse links and removal of people still referenced by family records.

Migration `002_person_relationships.sql` is additive. Existing parent links and free-text spouse/household details remain available for review; the application does not guess which parent an old generic link represents or parse prose into people automatically. Create/reuse the confirmed person records, select the relationships, then link the existing household. No real family names or deployment-specific data are embedded in migrations.

## Stack
Node 20 + TypeScript + Fastify 4, PostgreSQL 15, plain JS front end (no framework, no build step) in `web/`.
- `src/index.ts` API + static files, `src/hebrew.ts` Hebrew calendar, `src/bootstrap.ts` migrations / first admin,
  `src/jobs.ts` nightly backup, `db/migrations/*.sql` schema.
- Security: Argon2id password hashes, random session tokens (only their SHA-256 stored) in an HttpOnly, Secure,
  SameSite=Lax cookie; every write needs the `x-familye: 1` header (CSRF); rate limits on login/sign-up; CSP;
  uploads stored outside the web root and served only to members who can see that simcha.

## Run locally
```
npm install && npm run build
export DATABASE_URL=postgres://familye:PASS@127.0.0.1:5432/familye FAMILYE_DATA=./data
export ADMIN_NAME="..." ADMIN_PHONE="+1 ..." SETUP_TOKEN_SHA256=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)
node dist/bootstrap.js && node dist/index.js      # http://localhost:8080 ; admin opens /#setpw=$TOKEN once
```

## Deploy (single always-on box, how the Tab-hosted copy runs)
`tab-site.json` → `bash deploy/start.sh` on port 8080. The script installs PostgreSQL 15 once, keeps the database,
uploads and backups in `~/familye-data` (outside the app folder, so redeploys never touch data), generates the DB
password into `~/familye-data/secrets.env` (mode 600), takes a backup before every start, and the API writes a
nightly `pg_dump` (`~/familye-data/backups`, 14 days, newest 3 always kept).
Non-secret settings: `deploy/site.env`. Never committed: `deploy/admin.env` (the SHA-256 of the admin's one-time
setup token) and `deploy/qa.env` (temporary test mode; when it is absent at boot, all test users and their data are removed).

## A second family (e.g. Parnes / Landa — פרנס / לאנדא)
No code change. Deploy the same code a second time under a new name with its own database:
1. Copy this folder; in `deploy/site.env` set `PUBLIC_URL`, `ADMIN_*`, and the first-boot names
   (`FAMILY_YI`, `SIDE_A_FAMILY_YI` = father's side, `SIDE_B_FAMILY_YI` = mother's side, and the English ones).
2. Put `SETUP_TOKEN_SHA256=<sha256 of a fresh random token>` in `deploy/admin.env`.
3. Publish it as its own box site (e.g. slug `familye-parnes`); it gets its own `~/familye-data`.
4. Send the admin `https://<site>/#setpw=<token>` once. Names can be changed later in Admin → family names.

## Reproducible builds

```sh
npm ci
npm run check
npm test
node --check web/app.js
```

`npm test` builds the TypeScript entry points and runs the unit/build checks. Set `TEST_DATABASE_URL` to a PostgreSQL test database to also run the API integration test. It creates a fresh temporary schema, bootstraps an administrator, exercises approval, family-side access, tree cycles, competing learning claims, completion, RSVP and session persistence, then removes only that schema. Without a test database that integration test is explicitly skipped. Browser acceptance remains separate; `test/e2e-ui.cjs` requires its own Playwright environment and test accounts.

GitHub Actions runs these checks with PostgreSQL 15, builds the Docker image, and saves the compiled `familye-build` artifact. `dist/` is generated and ignored by Git. The existing box startup script now installs the build dependencies and compiles the current checkout before bootstrap; a compile failure stops startup.

## Resend account recovery

Set `RESEND_API_KEY` in the host's private secrets and `RESEND_FROM_EMAIL` to a sender on a verified Resend domain
(for example `Our Family <noreply@kobor.it.com>`). Never put a key in source, client assets or Git. Bootstrap applies
migration 006 before the matching API and web assets start. Sending is disabled when either setting is absent.

Members save an email in My Account, confirm their current password, then follow the one-hour verification link
sent to that address. Only verified emails receive automatic password-reset links. Changing the email removes
verification and expires old verification/recovery links. Verified addresses cannot be shared by two accounts.
Public recovery responses do not disclose membership or email addresses; requests are limited and deduplicated
for 15 minutes. A provider failure expires the candidate reset link and leaves administrator assistance available.
Links are stored as hashes and consumed once. Resend credentials remain server-side. Integration tests use a
local mocked Resend transport and never send real email. Live acceptance requires a real verified recipient.

Alternatively, build the container with `docker build -t familye .`. Supply the existing configuration variables (`DATABASE_URL`, `PUBLIC_URL`, `COOKIE_SECURE`, `ADMIN_NAME`, `ADMIN_PHONE`, `SETUP_TOKEN_SHA256`) through your host, and mount a persistent writable volume at `/data` for uploads and backups. The container listens on 8080 and checks `/api/health`; use an HTTPS reverse proxy. It runs bootstrap on startup and includes PostgreSQL 15 backup tools. Container creation does not itself deploy the app or connect SMS.
