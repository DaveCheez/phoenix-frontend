import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cartPage = readFileSync(new URL("../pages/cart.vue", import.meta.url), "utf8");
const checkoutPage = readFileSync(new URL("../pages/checkout.vue", import.meta.url), "utf8");
const nuxtConfig = readFileSync(new URL("../nuxt.config.ts", import.meta.url), "utf8");

test("cart and checkout pages set titles and descriptions", () => {
  assert.match(cartPage, /title:\s*"Your basket \| Phoenix Vanz"/);
  assert.match(cartPage, /Review the products in your Phoenix Vanz basket\./);
  assert.match(checkoutPage, /title:\s*"Order details \| Phoenix Vanz"/);
  assert.match(checkoutPage, /No payment is taken\./);
  const confirmationPage = readFileSync(new URL("../pages/order-confirmation.vue", import.meta.url), "utf8");
  assert.match(confirmationPage, /title:\s*"Order confirmation \| Phoenix Vanz"/);
});

test("checkout stays disabled", () => {
  assert.match(nuxtConfig, /checkoutEnabled:\s*false/);
  assert.match(nuxtConfig, /orderSubmissionEnabled:\s*false/);
  assert.match(checkoutPage, /v-if="!orderSubmissionEnabled"/);
  assert.match(checkoutPage, /Online payment is temporarily unavailable/);
  assert.equal(checkoutPage.includes("/api/place-order"), false);
  assert.equal(checkoutPage.includes("card-element"), false);
});
