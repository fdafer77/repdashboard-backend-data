# TaxRefresh backend for Render

This package contains the Node backend needed by:

- `taxrefreshdashboard.com`
- `taxrefresh-auth.com`
- `secure.taxrefresh.us`

## What this package includes

- Express API server
- Socket.IO server
- Postgres schema bootstrap
- Form 8821 PDF asset
- `render.yaml` blueprint for Render

## Before deploying

You will still need to supply these secret values in Render after the service is created:

- `REP_PASSWORD`
- `REP_JWT_SECRET`
- `GHL_WEBHOOK_SECRET`
- `GHL_PRIVATE_INTEGRATION_TOKEN`
- `GHL_LOCATION_ID`
- `ADMIN_DASHBOARD_PASSCODE`

Optional, only if you use them:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `BOLDSIGN_API_KEY`
- `GHL_SYNC_WEBHOOK_URL`
- `GHL_SYNC_WEBHOOK_SECRET`

## Render deploy steps

1. Create a new GitHub repo for this backend package.
2. Upload the contents of this folder to that repo.
3. In Render, create a new `Blueprint` deployment from the repo.
4. Render will create:
   - a web service named `taxrefresh-backend`
   - a Postgres database named `taxrefresh-postgres`
5. After the resources are created, open the web service settings.
6. Add the secret environment variables listed above.
7. Redeploy the web service.

## Important environment values already included

These are already set in `render.yaml`:

- `DATABASE_URL` from the Render Postgres instance
- `DB_SSL=1`
- `CLIENT_ORIGIN=https://taxrefreshdashboard.com,https://taxrefresh-auth.com,https://secure.taxrefresh.us`
- `PUBLIC_BASE_URL=https://secure.taxrefresh.us`
- `EXPERIENCE_BASE_URL=https://secure.taxrefresh.us`
- `BOLDSIGN_8821_PDF_PATH=./assets/f8821.pdf`

## After deployment

Once Render gives you the live backend URL, update:

- dashboard frontend `VITE_SERVER_URL`
- client portal `assets/config.js` `serverBase`

Set both to the new Render backend URL.

## Health check

Render can use:

- `/health`
