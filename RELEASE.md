# Phoenix Vanz stable frontend release — 2026-09-19

This is a consolidated replacement for the incremental frontend patches.

## Included

- Docker-based DigitalOcean deployment that preserves the complete Nuxt output.
- Nuxt 3.21.11 dependency refresh and removal of the conflicting Vitest/test-utils tree.
- Request-aware Django runtime configuration.
- Correct non-200 proxy errors and clearer runtime logs.
- Persistent anonymous cart with stale-ID recovery and serialised mutations.
- Cart quantity controls.
- Django-admin-driven homepage slideshow with bundled fallback images.
- Global toast notifications.
- SSR-safe category, category-detail and product-detail loading.
- Production smoke test.

## Deliberately not enabled

Online checkout remains disabled. A publishable Stripe key alone is not enough;
the backend still needs an order model, server-created Stripe payment session or
PaymentIntent, webhook confirmation, idempotency and option-aware pricing.
