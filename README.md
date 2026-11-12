# Familye — Yiddish extended-family app

A members-only family app in today's heimish Yiddish (right-to-left), for the cousins of two sides of a family.
Live: https://familye.sites.tab.bot/ (Bochner / Biderman — באכנער / בידערמאן).
`prototype/index.html` is the approved clickable mockup (made-up data, nothing saved): https://familye-proto.sites.tab.bot/

## What it does
- **Sign up / log in**: join through a family invitation (automatically assigned to that family),
  or create a new isolated family and become its family administrator. No unassigned signup. No SMS provider needed.
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

Visibility: a member sees only records in their assigned access family, narrowed by their side(s).
"Both"/"all" never crosses the family boundary. Family admins manage their own family only;
the main admin can explicitly select and correct any family. See [family isolation and rollout](docs/family-isolation.md),
including the required classification of legacy accounts and records before reopening member access.

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

## Yahrzeit reminders

Members can follow a yahrzeit or enable reminders for their ancestors on the yahrzeit page.
Ancestor reminders use the tree profile linked by an admin and only follow parent links within
families the member can access. Individual reminder choices take precedence. Email requires
a verified address. The worker starts three days before the observance date, uses the daily
learning reminder hour and timezone, and sends at most once per member and observance.
Reminders link to the yahrzeit and to an available Mishnayos list when one exists. The WhatsApp
button prepares a message for the member to share.

## Daily Mishnayos and Tehillim email reminders

Members enable daily learning emails under **My account** after verifying their email.
The reminder includes the Hebrew text of today's portions. Long readings include the full
text in a UTF-8 attachment. The bundled public-domain editions are Sefaria's [Torat Emet 357
Mishnah](https://www.sefaria.org/Mishnah_Berakhot?tab=versions), [vocalized Bikkurim chapter
4](https://www.sefaria.org/Mishnah_Bikkurim.4?lang=he), and [Tanach with Ta'amei
Hamikra](https://www.sefaria.org/Psalms?tab=versions). The learning catalogue fixes their order
and numbering. Sending mail does not need to fetch text from a third-party service.

A list can be dedicated to multiple yahrzeits. An explicit completion date applies to the
whole list. A blank date uses the earliest upcoming selected yahrzeit. Each learning list
also shows today's exact personal portions. The plan divides unfinished
claimed Mishnayos (including individual mishnayos and legacy whole masechtos) or Tehillim
chapters over the remaining calendar days, including the deadline. Members mark completed
portions in the list; missed days increase the next day's portion. Completed or returned
claims stop generating emails. Past deadlines generate no mail; undated lists honestly show
all remaining claims without inventing a completion date.

The existing Resend credentials are reused. `FAMILY_TZ` defaults to `America/New_York`;
`LEARNING_REMINDER_HOUR` defaults to `9` (0–23, in that timezone). An in-process job checks
every five minutes and after startup, so the host must keep the API running at reminder time.
`PUBLIC_URL` must be the deployed HTTPS origin so emails link back to the correct app.
No additional external scheduler or ChatGPT automation is required.

Messages require active membership, current family/side access, verified email and the
member's enabled preference. A PostgreSQL lock and durable per-user/list/local-date delivery
record prevent concurrent workers and restarts from duplicating accepted mail. Transient
provider failures retry using the same persisted body and Resend idempotency key, for at most
20 hours on that local date (within Resend's idempotency window). Changing an address suppresses
that day's pending delivery; the new address must be verified. Each email links to account
settings to disable reminders. Delivery records are retained for 90 days.

## Family calendar and reminders

Edit a person's profile to add a Hebrew birthday and first or second wedding
anniversary. The family calendar combines those dates with yahrzeits. The tree
and yahrzeit list offer a print view that can be saved as PDF from the print dialog.
Family admins can approve or reject members' suggestions from the admin review queue.

Yahrzeit reminders use the existing daily worker and are scheduled three days in
advance. Members can follow an individual yahrzeit or the ancestors linked to
their account. Email requires a verified address. WhatsApp uses the member's
account phone and requires a separate opt-in. Changing the number clears that opt-in.

To enable WhatsApp in production, configure the Meta Cloud API sender and an
approved utility template. The template body takes two text parameters, the Hebrew
date and the sign-in link. Example body: `A yahrzeit you follow is coming up on
{{1}}. Open Kobor at {{2}} to view the details.` Set `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_YAHRZEIT_TEMPLATE`, and
`WHATSAPP_YAHRZEIT_LANGUAGE` in the runtime. Store `WHATSAPP_ACCESS_TOKEN` as
a secret. The app enables WhatsApp opt-in once these settings are present.

## Live Yiddish wording

In the private Kobor wording spreadsheet, edit column B on the Wording tab. Keep the
placeholders shown in braces. Clearing an edit restores the built-in wording. A note
on B2 shows the last sync and flags rows with missing or changed placeholders.

For setup, add the same random `KOBOR_WORDING_SYNC_TOKEN` to the production runtime
secrets and to the spreadsheet's bound Apps Script properties. Copy
`deploy/wording-apps-script.gs` into that project and run `installKoborWording` once
as the sheet owner. This installs an edit trigger and a five-minute retry trigger.
The webhook writes only wording overrides. Kobor keeps the last accepted edits in
PostgreSQL, and open pages check for new wording every ten seconds.
