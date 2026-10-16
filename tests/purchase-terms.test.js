import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PURCHASE_TERMS } from "../utils/purchaseTerms.js";

const productPage = readFileSync(new URL("../pages/product/[slug].vue", import.meta.url), "utf8");
const cartPage = readFileSync(new URL("../pages/cart.vue", import.meta.url), "utf8");
const termsComponent = readFileSync(new URL("../components/PurchaseTerms.vue", import.meta.url), "utf8");

test("purchase terms state the owner-confirmed commercial rules", () => {
  assert.equal(PURCHASE_TERMS.heading, "Made to order & fitted by Phoenix Vanz");
  assert.equal(
    PURCHASE_TERMS.included,
    "Fitting is included in the displayed price. Workshop fitting in Accrington, Lancashire. No delivery. No VAT added.",
  );
  assert.equal(PURCHASE_TERMS.leadTime, "Typical lead time: approximately 4 weeks.");
  assert.equal(PURCHASE_TERMS.included.includes("extra"), false);
  assert.equal(PURCHASE_TERMS.included.toLowerCase().includes("delivery is available"), false);
  assert.equal(PURCHASE_TERMS.included.toLowerCase().includes("vat") && PURCHASE_TERMS.included.includes("No VAT added"), true);
});

test("product and cart show the same terms beside price and basket actions", () => {
  assert.match(termsComponent, /PURCHASE_TERMS\.heading/);
  assert.match(termsComponent, /PURCHASE_TERMS\.included/);
  assert.match(termsComponent, /PURCHASE_TERMS\.leadTime/);

  const priceAt = productPage.indexOf("Estimated configured price");
  const productTermsAt = productPage.indexOf("<PurchaseTerms");
  const addAt = productPage.indexOf("Add to Cart");
  assert.ok(priceAt >= 0 && productTermsAt > priceAt && productTermsAt < addAt);

  const summaryAt = cartPage.indexOf("Order Summary");
  const cartTermsAt = cartPage.indexOf("<PurchaseTerms");
  const checkoutAt = cartPage.indexOf("Proceed to Checkout");
  assert.ok(summaryAt >= 0 && cartTermsAt > summaryAt && cartTermsAt < checkoutAt);
  assert.equal((cartPage.match(/<PurchaseTerms/g) || []).length, 2);
  assert.match(cartPage, /Your cart is empty\./);
  assert.equal(cartPage.includes("Workshop fitting only"), false);
  assert.equal(cartPage.includes("Delivery is not available"), false);
  assert.equal(cartPage.includes("We will confirm fitting"), false);
});
