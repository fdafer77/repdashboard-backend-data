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
- `BOLDSIGN_BRAND_ID`
- `BOLDSIGN_BRAND_ID_MFJ`
- `BOLDSIGN_BRAND_ID_SINGLE`
- `BOLDSIGN_HIDE_DOCUMENT_ID`
- `GHL_SYNC_WEBHOOK_URL`
- `GHL_SYNC_WEBHOOK_SECRET`

Canopy sync, only when you are ready to push EA-active clients into Canopy:

- `CANOPY_SYNC_ENABLED`
- `CANOPY_SYNC_TARGET_URL`
- `CANOPY_SYNC_AUTH_TOKEN`
- `CANOPY_SYNC_AUTH_HEADER`
- `CANOPY_SYNC_AUTH_SCHEME`
- `CANOPY_SYNC_POLL_MS`
- `CANOPY_SYNC_MAX_ATTEMPTS`
- `CANOPY_SYNC_STARTUP_BACKFILL`
- `CANOPY_SYNC_ACTIVE_EA_STATUSES`

Canopy OAuth, when you want the backend to hold a saved bearer token from Canopy:

- `CANOPY_OAUTH_APP_URL`
- `CANOPY_OAUTH_API_URL`
- `CANOPY_OAUTH_TOKEN_URL`
- `CANOPY_OAUTH_CLIENT_ID`
- `CANOPY_OAUTH_CLIENT_SECRET`
- `CANOPY_OAUTH_REDIRECT_URL`
- `CANOPY_OAUTH_SCOPE`
- `CANOPY_OAUTH_ENCRYPTION_KEY`
- `CANOPY_OAUTH_STATE_SECRET`
- `CANOPY_OAUTH_SUCCESS_REDIRECT`
- `CANOPY_OAUTH_FAILURE_REDIRECT`

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

Canopy sync defaults are also included in `render.yaml`, but they start in a safe disabled state:

- `CANOPY_SYNC_ENABLED=0`
- `CANOPY_SYNC_AUTH_HEADER=authorization`
- `CANOPY_SYNC_AUTH_SCHEME=Bearer`
- `CANOPY_SYNC_POLL_MS=60000`
- `CANOPY_SYNC_MAX_ATTEMPTS=6`
- `CANOPY_SYNC_STARTUP_BACKFILL=0`
- `CANOPY_SYNC_ACTIVE_EA_STATUSES=Pending EA Review,Ready for Resolution Review,Ready for Resolution,Resolution In Progress,Awaiting Program`

You still need to provide these Canopy secrets in Render before enabling the worker:

- `CANOPY_SYNC_TARGET_URL`
- `CANOPY_SYNC_AUTH_TOKEN`

If you are using Canopy OAuth instead of a static sync token, also provide:

- `CANOPY_OAUTH_CLIENT_ID`
- `CANOPY_OAUTH_CLIENT_SECRET`
- `CANOPY_OAUTH_ENCRYPTION_KEY`
- `CANOPY_OAUTH_STATE_SECRET`

## Canopy rollout order

Use this order so the dashboard stays untouched while you validate the mirror path.

1. Deploy the backend with `CANOPY_SYNC_ENABLED=0`.
2. Add `CANOPY_SYNC_TARGET_URL` and `CANOPY_SYNC_AUTH_TOKEN` in Render.
3. Redeploy and confirm the backend is healthy at `/health`.
4. Flip `CANOPY_SYNC_ENABLED=1` and keep `CANOPY_SYNC_STARTUP_BACKFILL=0`.
5. Create or update one EA-active test client in the dashboard and verify the client appears correctly in Canopy.
6. If that single-client test succeeds, call the admin backfill endpoint `POST /api/admin/canopy/backfill-active-clients` to queue the current EA-active clients.
7. Only after the backfill looks correct should you consider turning on `CANOPY_SYNC_STARTUP_BACKFILL=1`.

## Recommended initial values

These are the safest first values in Render:

- `CANOPY_SYNC_ENABLED=0` for the first deploy, then `1` after the target is verified
- `CANOPY_SYNC_TARGET_URL=<your Canopy upsert endpoint or your proxy endpoint>`
- `CANOPY_SYNC_AUTH_TOKEN=<secret token>`
- `CANOPY_SYNC_AUTH_HEADER=authorization`
- `CANOPY_SYNC_AUTH_SCHEME=Bearer`
- `CANOPY_SYNC_POLL_MS=60000`
- `CANOPY_SYNC_MAX_ATTEMPTS=6`
- `CANOPY_SYNC_STARTUP_BACKFILL=0`
- `CANOPY_SYNC_ACTIVE_EA_STATUSES=Pending EA Review,Ready for Resolution Review,Ready for Resolution,Resolution In Progress,Awaiting Program`

Recommended Canopy OAuth values:

- `CANOPY_OAUTH_APP_URL=https://app.canopytax.com`
- `CANOPY_OAUTH_API_URL=https://api.canopytax.com`
- `CANOPY_OAUTH_TOKEN_URL=https://api.canopytax.com/public/v3/token`
- `CANOPY_OAUTH_REDIRECT_URL=https://api.taxrefresh.com/api/canopy/callback`
- `CANOPY_OAUTH_SCOPE=contacts:read`
- `CANOPY_OAUTH_ENCRYPTION_KEY=<32+ char secret stored only in Render>`
- `CANOPY_OAUTH_STATE_SECRET=<separate secret stored only in Render>`

## Canopy OAuth endpoints

Once deployed, these backend routes are available:

- `GET /api/admin/canopy/oauth/start`
- `GET /api/admin/canopy/oauth/status`
- `POST /api/admin/canopy/oauth/refresh`
- `GET /api/canopy/callback`

Use the admin `start` route to generate or redirect to the Canopy authorization URL. The callback route exchanges the returned code for tokens, stores them in Postgres in encrypted form, and the sync worker will automatically prefer the saved bearer token over `CANOPY_SYNC_AUTH_TOKEN` when present.

## BoldSign branding control

The backend can now force a specific BoldSign brand when sending 8821 documents.

- `BOLDSIGN_BRAND_ID`: default brand for all 8821 sends
- `BOLDSIGN_BRAND_ID_MFJ`: optional override for MFJ packets
- `BOLDSIGN_BRAND_ID_SINGLE`: optional override for single filers
- `BOLDSIGN_HIDE_DOCUMENT_ID=1`: tells BoldSign to hide the document ID on newly sent 8821 documents

If these are not set, BoldSign will fall back to the account or template default brand.

## After deployment

Once Render gives you the live backend URL, update:

- dashboard frontend `VITE_SERVER_URL`
- client portal `assets/config.js` `serverBase`

Set both to the new Render backend URL.

## Health check

Render can use:

- `/health`
