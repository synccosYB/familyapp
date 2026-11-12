# Familye

Existing Node/TypeScript + Fastify + PostgreSQL application. Preserve the approved Yiddish/RTL interface in public/ and existing API/database workflows. prototype/ is a historical clickable mockup, not the application to deploy.

- SMS is explicitly deferred by the owner. Use the existing invitation/password accounts.
- Run: npm ci --include=dev && npm run build && npm start.
- Publish as a server application (Autoscale), not static hosting. Listen on 0.0.0.0 and PORT.
- DATABASE_URL must point to this app's PostgreSQL database; use separate development and production data.
- APP_ORIGIN must exactly match the browser-facing HTTPS origin for the current environment, with no trailing slash. Do not disable origin checks when preview and production URLs differ.
- NODE_ENV=production for the published application. Use development for workspace preview.
- Initial administrator uses ADMIN_LOGIN, ADMIN_NAME and ADMIN_PASSWORD from Secrets; remove bootstrap credentials after first sign-in. Existing credentials are not reset by changing these variables.
- Migrations run automatically at server startup. Do not run the integration tests against real family data: TEST_DATABASE_URL is for a disposable test database only.
- Check with npm run check, node --check public/app.js, npm test, npm run build.
- The README documents remaining scope; do not imply automatic Hebrew anniversary calculations or reminders already exist.
