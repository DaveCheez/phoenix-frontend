# Phoenix Vanz Nuxt Frontend - DigitalOcean App Platform

This is a Nuxt 3 server-rendered application with routes under `server/api/`.
Deploy it as a **Web Service**, not as a static site.

The package is configured for a new deployment alongside the current live site.
Do not change the production domains until the temporary DigitalOcean URL has
passed every test below.

## What was changed

- Replaced hard-coded backend URLs with server-side Nuxt runtime configuration.
- Removed direct PostgreSQL access from the frontend. Product and cart data now
  goes through the Django API.
- Removed the broken top-level cart route that conflicted with nested cart routes.
- Added `/api/health` for App Platform health checks.
- Added functional cart proxy routes, including cart ID on update calls.
- Moved the Stripe publishable key out of source code.
- Kept the Google Places API key server-only.
- Corrected the logo public path.
- Pinned Node 22/npm 10 and dependency versions.
- Added DigitalOcean app specs and local environment examples.

## Files

- `.do/app.yaml`: first deployment using only the temporary `.ondigitalocean.app` URL.
- `.do/app-production.example.yaml`: reference showing production domains; do not upload it over configured secrets.
- `.env.example`: local environment-variable reference.

## Region check before creating the app

The app spec currently uses `region: lon`. First confirm the region of the existing
managed PostgreSQL database used by the Django backend. If that database is not in
London, change `region:` in both frontend app-spec files to match the backend/database
region before deployment.

## Required value before deployment

Set `NUXT_DJANGO_API_BASE` to the new backend URL, retaining `/api` at the end.
For example:

```text
https://your-new-backend.ondigitalocean.app/api
```

The app spec uses `USE_NPM_INSTALL=true` because the uploaded source did not
contain a package lockfile. After the first successful dependency install, it is
better to create and commit `package-lock.json` so future builds are reproducible.

## Optional integrations

Add these through DigitalOcean's Environment Variables screen when required:

```text
NUXT_PUBLIC_CHECKOUT_ENABLED=false
NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<Stripe publishable key beginning pk_...>
NUXT_GOOGLE_PLACES_API_KEY=<server-only Google Places API key>
NUXT_GOOGLE_PLACES_PLACE_ID=ChIJ8_c21s8Ke0gRA_p2G3v4g3g
```

A Stripe publishable key is designed to be present in browser code. Never add a
Stripe secret key to this frontend repository or to a `NUXT_PUBLIC_*` variable.

## Checkout warning

The uploaded app has no `/api/place-order` implementation and no server-side
Stripe PaymentIntent/order-processing route. The checkout page can collect a
PaymentMethod, but it cannot safely take payment or create an order. The prepared
version no longer redirects customers to a success page when that endpoint
returns an error.

Do not advertise online checkout as operational until a server-side payment and
order flow has been implemented and tested. Product browsing and cart features
can still be deployed.

## Safe deployment sequence

1. Deploy and verify the prepared Django API first.
2. Push this prepared source to `DaveCheez/phoenix-vanz-frontend` (or change the
   repository/branch fields in the app spec).
3. Create a new DigitalOcean app from `.do/app.yaml`.
4. Set `NUXT_DJANGO_API_BASE` to the temporary backend domain.
5. Launch the app and test its temporary URL:
   - `/api/health` returns `{"status":"ok"}`
   - homepage and navigation load
   - product categories load
   - category and product pages load images
   - a cart can be created
   - add/read/remove cart operations work
   - Google reviews fail gracefully when the optional key is absent
   - checkout does not show a false success message
6. Test desktop and mobile layouts.
7. When both apps pass, ensure the backend allows the production frontend origins.
8. Add the production domains in the DigitalOcean Networking tab. Use
   `.do/app-production.example.yaml` only as a reference; uploading it over a
   configured app could replace encrypted environment-variable values.
9. Keep the old frontend available until DNS, HTTPS, browsing and cart smoke
   tests pass on the new deployment.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

The local Django API default is `http://127.0.0.1:8000/api`.

## Backlog feature deployment

The frontend now expects the slideshow endpoint at the configured Django API
base and falls back to the bundled homepage images when no active slides exist.

For Stripe.js, set the browser-safe publishable key on the frontend app:

```text
NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Use a `pk_test_...` value while testing. Never place `sk_test_...` or
`sk_live_...` in the frontend. The server-side order and payment implementation
is still intentionally disabled until the order rules are confirmed.
