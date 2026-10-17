import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  confirmationRecord,
  formatPounds,
  isOrderReference,
  paymentExplanation,
  publicOrderView,
  submissionKey,
  validateCustomer,
} from "../utils/orderConfirmation.js";
import { PURCHASE_TERMS } from "../utils/purchaseTerms.js";

const confirmationPage = readFileSync(new URL("../pages/order-confirmation.vue", import.meta.url), "utf8");
const checkoutPage = readFileSync(new URL("../pages/checkout.vue", import.meta.url), "utf8");
const nuxtConfig = readFileSync(new URL("../nuxt.config.ts", import.meta.url), "utf8");

const customer = {
  customer_name: "Alex Farmer",
  customer_email: "alex@example.com",
  customer_phone: "01254 000000",
  vehicle_make: "Volkswagen",
  vehicle_model: "T6.1",
  vehicle_year: "2021",
  vehicle_wheelbase: "LWB",
};

function orderPayload() {
  return {
    id: "secret-id",
    internal_notes: "workshop only",
    guest_session: "session",
    source_cart: "cart",
    token: "raw-token",
    stripe_payment_intent: "pi_secret",
    reference: "PV-TEST1234",
    created_at: "2026-10-17T21:00:00+00:00",
    customer_name: "Alex Farmer",
    customer_email: "alex@example.com",
    customer_phone: "01254 000000",
    vehicle_make: "Volkswagen",
    vehicle_model: "T6.1",
    vehicle_year: 2021,
    vehicle_wheelbase: "LWB",
    currency: "GBP",
    full_total: "825.00",
    deposit_required: "275.00",
    balance_on_completion: "550.00",
    fitting_charge: "0.00",
    tax_amount: "0.00",
    payment_status: "pending_deposit",
    payment_terms_text: "One-third deposit. Balance due on completion of the work and fitting.",
    items: [
      {
        original_product_id: 9,
        product_name: "Retro Roof Rack",
        quantity: 1,
        configured_unit_price: "825.00",
        line_total: "825.00",
        options: [
          { group_name: "Wheelbase", option_name: "LWB", price_adjustment: "130.00" },
        ],
      },
    ],
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("a confirmation shows the reference, products, prices and unpaid state", () => {
  const view = publicOrderView(orderPayload());
  assert.equal(view.reference, "PV-TEST1234");
  assert.equal(view.items[0].productName, "Retro Roof Rack");
  assert.equal(view.items[0].quantity, 1);
  assert.equal(view.items[0].options[0].optionName, "LWB");
  assert.equal(formatPounds(view.fullTotal), "£825.00");
  assert.equal(formatPounds(view.items[0].configuredUnitPrice), "£825.00");
  const payment = paymentExplanation(view.paymentStatus);
  assert.equal(payment.unpaid, true);
  assert.match(payment.heading, /Payment has not been taken/);
  assert.match(payment.detail, /waiting/);
  assert.match(confirmationRecord(view), /PV-TEST1234/);
  assert.equal(confirmationRecord(view).includes("alex@example.com"), false);
  assert.equal(confirmationRecord(view).includes("secret"), false);
});

test("confirmation data drops internal and sensitive fields", () => {
  const view = publicOrderView(orderPayload());
  const serialised = JSON.stringify(view);
  for (const hidden of ["secret-id", "internal_notes", "raw-token", "pi_secret", "original_product_id", "guest_session", "source_cart"]) {
    assert.equal(serialised.includes(hidden), false, hidden);
  }
  assert.equal(Object.hasOwn(view, "id"), false);
  assert.equal(view.customerName, "Alex Farmer");
});

test("missing and invalid references are not treated as an order", () => {
  assert.equal(isOrderReference(""), false);
  assert.equal(isOrderReference("../admin"), false);
  assert.equal(isOrderReference("PV TEST"), false);
  assert.equal(publicOrderView(null), null);
  assert.equal(publicOrderView({ ...orderPayload(), reference: "no" }), null);
  assert.match(confirmationPage, /This order is not available/);
  assert.match(confirmationPage, /method: "GET"/);
  assert.equal(confirmationPage.includes('method: "POST"'), false);
});

test("the same submission reuses its key and a changed payload does not silently create another", () => {
  const storage = memoryStorage();
  const validated = validateCustomer(customer);
  assert.equal(validated.ok, true);
  const first = submissionKey(storage, validated.body, { createKey: () => "order-key-1" });
  const repeat = submissionKey(storage, validated.body, { createKey: () => "order-key-2" });
  assert.equal(first.action, "created");
  assert.equal(repeat.action, "reuse");
  assert.equal(repeat.key, "order-key-1");
  const changed = submissionKey(storage, { ...validated.body, customer_name: "Sam Farmer" }, {
    createKey: () => "order-key-3",
  });
  assert.equal(changed.action, "conflict");
  const separate = submissionKey(storage, { ...validated.body, customer_name: "Sam Farmer" }, {
    replace: true,
    createKey: () => "order-key-3",
  });
  assert.equal(separate.action, "replaced");
  assert.equal(separate.key, "order-key-3");
});

test("confirmation and checkout stay unpaid and use the approved commercial terms", () => {
  assert.match(nuxtConfig, /checkoutEnabled:\s*false/);
  assert.match(checkoutPage, /v-if="!checkoutEnabled"/);
  assert.match(checkoutPage, /Online payment is temporarily unavailable/);
  assert.match(checkoutPage, /Create unpaid order/);
  assert.match(checkoutPage, /idempotency-key/);
  assert.equal(checkoutPage.includes("full_total"), false);
  assert.match(confirmationPage, /PurchaseTerms/);
  assert.match(confirmationPage, /Copy reference/);
  assert.match(confirmationPage, /Save reference/);
  assert.match(confirmationPage, /min-h-11/);
  assert.match(confirmationPage, /sm:flex-row/);
  assert.match(confirmationPage, /aria-labelledby="payment-state"/);
  assert.match(confirmationPage, /<label for="order-lookup"/);
  assert.equal(PURCHASE_TERMS.included.includes("No delivery"), true);
  assert.equal(PURCHASE_TERMS.included.includes("No VAT added"), true);
  assert.match(PURCHASE_TERMS.included, /Accrington/);
  assert.match(PURCHASE_TERMS.leadTime, /4 weeks/);
});
