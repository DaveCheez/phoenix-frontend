import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cartPage = readFileSync(new URL("../pages/cart.vue", import.meta.url), "utf8");
const checkoutPage = readFileSync(new URL("../pages/checkout.vue", import.meta.url), "utf8");
const nuxtConfig = readFileSync(new URL("../nuxt.config.ts", import.meta.url), "utf8");

test("cart and checkout pages set titles and descriptions", () => {
  assert.match(cartPage, /title:\s*"Your basket \| Phoenix Vanz"/);
  assert.match(cartPage, /Review the products in your Phoenix Vanz basket\./);
  assert.match(checkoutPage, /title:\s*"Checkout \| Phoenix Vanz"/);
  assert.match(
    checkoutPage,
    /Online checkout is temporarily unavailable\. Contact Phoenix Vanz to order\./,
  );
});

test("checkout stays disabled", () => {
  assert.match(nuxtConfig, /checkoutEnabled:\s*false/);
  assert.match(checkoutPage, /v-if="!checkoutEnabled"/);
  assert.match(checkoutPage, /Online payment is temporarily unavailable/);
});
