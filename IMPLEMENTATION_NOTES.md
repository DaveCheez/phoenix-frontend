# Stable release changes

## Deployment/runtime fix

- Upgraded the application from the old Nuxt 3.14 dependency line to Nuxt
  3.21.11.
- Removed unused Nuxt modules and conflicting test packages.
- Added a multi-stage Dockerfile so `.output/server` and `.output/public` are
  always deployed as one unit.
- Removed the need for the public-directory copy/symlink workarounds.
- Added a deployment smoke-test script.

## Central API configuration

- Every Nuxt server proxy now reads `NUXT_DJANGO_API_BASE` using request-aware
  runtime configuration.
- The old local development URL cannot silently override the production value.
- Proxy failures return meaningful HTTP status codes instead of a false HTTP
  200 response containing `{ "error": ... }`.
- Public catalogue endpoints have conservative cache headers; cart responses
  remain private and uncached.

## Cart work

- Cart IDs are validated and persisted through an HttpOnly cookie and browser
  local storage.
- Stale cart IDs are replaced transparently.
- Mutation requests are serialised to avoid overlapping updates.
- Older GET responses cannot overwrite a newer cart mutation.
- Quantity increase, decrease, direct entry and removal are supported.
- Updated cart payloads are applied immediately without an unnecessary second
  request.

## Homepage and user experience

- Homepage slides come from Django admin through `/api/slides`.
- Three local fallback slides are compiled into the Nuxt client bundle rather
  than depending on runtime filesystem paths.
- Navigation and product-category cards load through SSR-safe `useFetch` calls.
- Toast notifications report successful and failed cart actions.
- Product and category pages now load data through Nuxt data fetching instead
  of waiting for `onMounted`.

## Checkout

The frontend validates that a Stripe browser key starts with `pk_test_` or
`pk_live_`, but online checkout remains disabled by default because the project
still lacks a complete server-side order, PaymentIntent/Checkout Session and
webhook implementation.
