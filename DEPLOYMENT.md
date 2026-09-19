# Phoenix Vanz frontend: stable DigitalOcean deployment

This release replaces the fragile Node buildpack deployment with a multi-stage
Docker build. The complete Nuxt `.output` directory is copied into the runtime
image, including `.output/public`, so pages, generated client assets, the
favicon and legacy files under `public/` are deployed together.

## 1. Local preparation

Use Node 22 and npm 10.

```bash
npm install
npm run build
```

The first `npm install` creates `package-lock.json`. Commit that file so later
builds use the same dependency tree.

## 2. Production-style local test

```bash
docker build -t phoenix-vanz-frontend .

docker run --rm -p 8080:8080 \
  -e NUXT_DJANGO_API_BASE=https://phoenix-backend-j6dci.ondigitalocean.app/api \
  -e NUXT_PUBLIC_CHECKOUT_ENABLED=false \
  phoenix-vanz-frontend
```

On Windows PowerShell, use a single line or replace the shell continuation
characters as appropriate.

Test:

```text
http://127.0.0.1:8080/api/health
http://127.0.0.1:8080/
http://127.0.0.1:8080/cart
http://127.0.0.1:8080/favicon.ico
```

Run the bundled smoke test:

```bash
npm run smoke -- http://127.0.0.1:8080
```

## 3. Required DigitalOcean environment variables

Set these on the frontend service:

```text
NODE_ENV=production
NITRO_HOST=0.0.0.0
NITRO_PORT=8080
NUXT_DJANGO_API_BASE=https://phoenix-backend-j6dci.ondigitalocean.app/api
NUXT_PUBLIC_SITE_URL=https://phoenix-frontend-ee5nt.ondigitalocean.app
NUXT_PUBLIC_CHECKOUT_ENABLED=false
```

Optional:

```text
NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NUXT_GOOGLE_PLACES_API_KEY=...
NUXT_GOOGLE_PLACES_PLACE_ID=...
```

Keep checkout disabled until a server-side order/payment flow and Stripe
webhook have been implemented.

## 4. DigitalOcean component settings

The repository root contains `Dockerfile`. DigitalOcean should build that
Dockerfile instead of using the Node buildpack.

The included `.do/app.yaml` sets:

```text
Dockerfile: Dockerfile
HTTP port: 8080
Health check: /api/health
```

Remove obsolete buildpack-only variables such as:

```text
USE_NPM_INSTALL
NPM_CONFIG_PRODUCTION
```

Do not add a custom run command that copies or symlinks public files. The
Docker image already contains the complete `.output` directory and starts with:

```text
node .output/server/index.mjs
```

## 5. Deployment verification

After deployment:

```bash
npm run smoke -- https://phoenix-frontend-ee5nt.ondigitalocean.app
```

Then manually test:

1. Main navigation categories load.
2. Homepage shows Django slides or the bundled fallback slides.
3. A product can be added to the cart.
4. Cart quantity can be increased, decreased and edited directly.
5. A refresh preserves the anonymous cart.
6. Toast notifications appear after cart changes.
7. Product, category and Spaces-hosted media render.

## 6. Rollback

Keep the current working deployment available until all checks pass. If the new
container fails health checks, roll back from DigitalOcean Activity rather than
editing the running container.
