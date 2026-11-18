import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BASKET_BLOCK_MESSAGES,
  ORDER_ATTEMPT_STORAGE_KEY,
  ORDER_MESSAGES,
  basketSubmissionBlock,
  buildOrderBody,
  createOrderController,
  readOrderConfirmation,
  validateOrderRecord,
} from "../utils/orderClient.js";

const TOKEN = "ab".repeat(32);
const OTHER_TOKEN = "cd".repeat(32);

function memoryStorage(initial) {
  const data = new Map(initial || []);
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: () => data.get(ORDER_ATTEMPT_STORAGE_KEY) || "",
  };
}

function mutex() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

function fields() {
  return {
    customer_name: "Alex Farmer",
    customer_email: "alex@example.com",
    customer_phone: "01254 000000",
    vehicle_make: "Volkswagen",
    vehicle_model: "Transporter",
    vehicle_year: "2020",
    vehicle_wheelbase: "LWB",
    vehicle_registration: "",
    customer_notes: "Side door",
  };
}

function basket(token = TOKEN) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    cart_review_token: token,
    items: [{
      item_id: 7,
      name: "Unpaid Order Demo",
      quantity: 2,
      configured_unit_price: "125.00",
      line_total: "250.00",
      configuration_valid: true,
      selected_options: [
        { group_id: 1, group_name: "Specification", option_id: 2, option_name: "Enhanced", price_adjustment: "25.00" },
        { group_id: 3, group_name: "Extra", option_id: 4, option_name: "None", price_adjustment: "0.00" },
      ],
    }],
    item_count: 2,
    total: "250.00",
  };
}

function orderRecord(reference = "PV-TEST") {
  return {
    reference,
    customer_name: "Alex Farmer",
    customer_email: "alex@example.com",
    customer_phone: "01254 000000",
    vehicle_make: "Volkswagen",
    vehicle_model: "Transporter",
    vehicle_year: 2020,
    vehicle_wheelbase: "LWB",
    vehicle_registration: "",
    customer_notes: "Side door",
    full_total: "250.00",
    deposit_required: "83.33",
    balance_on_completion: "166.67",
    payment_status: "pending_deposit",
    items: [{
      product_name: "Unpaid Order Demo",
      quantity: 2,
      configured_unit_price: "125.00",
      line_total: "250.00",
      options: [
        { group_name: "Specification", option_name: "Enhanced", price_adjustment: "25.00" },
        { group_name: "Extra", option_name: "None", price_adjustment: "0.00" },
      ],
    }],
  };
}

function csrf() {
  return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
}

function controllerFor(state, fetch, extras = {}) {
  const keys = [];
  const controller = createOrderController({
    fetch,
    locksAvailable: () => extras.locksAvailable !== false,
    lock: extras.lock || mutex(),
    storage: extras.storage || memoryStorage(),
    refreshBasket: extras.refreshBasket || (async () => {}),
    cartState: () => state,
    createKey: () => {
      const key = `order-key-${keys.length + 1}`;
      keys.push(key);
      return key;
    },
  });
  return { controller, keys };
}

test("order summary keeps zero-price options and blocks an unconfirmed basket", () => {
  const checkout = readFileSync(new URL("../pages/checkout.vue", import.meta.url), "utf8");
  const confirmation = readFileSync(new URL("../pages/order-confirmation.vue", import.meta.url), "utf8");
  const cart = readFileSync(new URL("../pages/cart.vue", import.meta.url), "utf8");
  assert.match(cart, /Continue to order details/);
  assert.match(checkout, /Submit unpaid order/);
  assert.match(checkout, /No payment will be taken\. Phoenix Vanz will confirm fitment and fitting arrangements\./);
  assert.match(checkout, /Back to basket/);
  assert.match(checkout, /Full name/);
  assert.match(checkout, /Vehicle year/);
  assert.match(checkout, /Wheelbase/);
  assert.match(checkout, /Included/);
  assert.equal(checkout.includes("price_adjustment !== '0.00'"), false);
  const mounted = checkout.slice(checkout.lastIndexOf("onMounted"));
  assert.match(mounted, /loadCart\(/);
  assert.equal(mounted.includes("orders.submit"), false);
  assert.match(confirmation, /Your order has been received\. No payment has been taken\./);
  assert.match(confirmation, /Your order is awaiting a deposit and confirmation of fitting arrangements\./);
  assert.match(confirmation, /Balance after the deposit/);
  assert.equal(confirmation.includes("POST"), false);
  assert.equal(confirmation.includes("localStorage"), false);
  assert.equal(readFileSync(new URL("../utils/orderClient.js", import.meta.url), "utf8").includes("validateCartPayload"), false);
  assert.equal(basketSubmissionBlock({ cart: basket(), access: "ready", pending: true }), "pending");
  assert.equal(basketSubmissionBlock({ cart: null, access: "temporary", pending: false }), "unconfirmed");
  assert.equal(basketSubmissionBlock({ cart: { ...basket(), items: [] }, access: "ready", pending: false }), "empty");
  assert.equal(BASKET_BLOCK_MESSAGES.empty.includes("empty"), true);
});

test("a reference alone is not a confirmed order", () => {
  assert.equal(validateOrderRecord({ reference: "PV-TEST" }), null);
  assert.equal(validateOrderRecord({ ...orderRecord(), full_total: "10.00" }), null);
  assert.equal(validateOrderRecord({ ...orderRecord(), payment_status: "paid" }), null);
  const valid = validateOrderRecord(orderRecord());
  assert.equal(valid.reference, "PV-TEST");
  assert.equal(valid.items[0].options[1].price_adjustment, "0.00");
  assert.equal(valid.deposit_required, "83.33");
  assert.equal(valid.balance_on_completion, "166.67");
});

test("missing details are not sent and a review token is forwarded as JSON", async () => {
  const posts = [];
  const state = { cart: basket(), access: "ready", pending: false };
  const { controller } = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return csrf();
    posts.push({ path, options });
    return { status: 201, _data: { success: true, order: orderRecord() } };
  });
  const incomplete = fields();
  delete incomplete.customer_phone;
  const blocked = await controller.submit(incomplete);
  assert.equal(blocked.outcome, "preparation");
  assert.equal(blocked.sent, false);
  assert.equal(blocked.field, "customer_phone");
  assert.equal(posts.length, 0);
  assert.equal(incomplete.customer_name, "Alex Farmer");

  const input = fields();
  const created = await controller.submit(input);
  assert.equal(created.outcome, "success");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].options.retry, 0);
  assert.equal(posts[0].options.method, "POST");
  assert.equal(posts[0].options.headers["idempotency-key"], "order-key-1");
  assert.equal(posts[0].options.headers["x-phoenix-csrf"], "csrf-1");
  assert.equal(posts[0].options.body.cart_review_token, TOKEN);
  assert.equal(posts[0].options.body.vehicle_year, 2020);
  assert.equal(typeof posts[0].options.body.vehicle_year, "number");
  assert.equal(posts[0].options.body.customer_notes, "Side door");
  assert.deepEqual(input, fields());
  const built = buildOrderBody(fields(), TOKEN);
  assert.equal(built.body.cart_review_token, TOKEN);
});

test("CART_CHANGED refreshes the basket, keeps the typed details, and waits for another submit", async () => {
  const posts = [];
  let refreshed = 0;
  const state = { cart: basket(), access: "ready", pending: false };
  const storage = memoryStorage();
  const { controller, keys } = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return csrf();
    posts.push(options.body.cart_review_token);
    if (posts.length === 1) return { status: 409, _data: { success: false, code: "CART_CHANGED", error: "raw upstream" } };
    return { status: 201, _data: { success: true, order: orderRecord("PV-NEXT") } };
  }, {
    storage,
    refreshBasket: async () => {
      refreshed += 1;
      state.cart = basket(OTHER_TOKEN);
    },
  });
  const input = fields();
  const changed = await controller.submit(input);
  assert.equal(changed.outcome, "cart_changed");
  assert.equal(changed.message, ORDER_MESSAGES.cartChanged);
  assert.equal(changed.message.includes("raw upstream"), false);
  assert.equal(refreshed, 1);
  assert.deepEqual(input, fields());
  assert.equal(controller.status().phase, "idle");
  assert.equal(storage.raw(), "");
  const created = await controller.submit(input);
  assert.equal(created.outcome, "success");
  assert.equal(posts[1], OTHER_TOKEN);
  assert.equal(keys[0] === keys[1], false);
});

test("duplicate clicks send one request and an explicit retry reuses the key", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const posts = [];
  const state = { cart: basket(), access: "ready", pending: false };
  const storage = memoryStorage();
  let failed = true;
  const { controller } = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return csrf();
    posts.push(options);
    if (failed) {
      failed = false;
      await gate;
      throw new Error("socket down");
    }
    return { status: 201, _data: { success: true, order: orderRecord() } };
  }, { storage });
  const input = fields();
  const first = controller.submit(input);
  const second = controller.submit(input);
  release();
  const [created, duplicate] = await Promise.all([first, second]);
  assert.equal(posts.length, 1);
  assert.equal(created.outcome, "uncertain");
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal(storage.raw().includes("alex@example.com"), false);
  assert.equal(storage.raw().includes("csrf-1"), false);
  assert.equal(storage.raw(), JSON.stringify({ state: "unresolved" }));
  const refused = await controller.submit(input);
  assert.equal(refused.sent, false);
  assert.equal(posts.length, 1);
  input.customer_name = "Changed Name";
  const retried = await controller.retry();
  assert.equal(retried.outcome, "success");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers["idempotency-key"], posts[1].headers["idempotency-key"]);
  assert.equal(posts[1].body.customer_name, "Alex Farmer");
  assert.equal(posts[1].retry, 0);
});

test("a reload cannot turn an unresolved attempt into a new order", async () => {
  const storage = memoryStorage();
  const state = { cart: basket(), access: "ready", pending: false };
  let posts = 0;
  const fetch = async (path) => {
    if (path === "/api/cart/csrf") return csrf();
    posts += 1;
    return { status: 503, _data: { success: false, code: "ORDER_TEMPORARILY_UNAVAILABLE" } };
  };
  const first = controllerFor(state, fetch, { storage });
  const uncertain = await first.controller.submit(fields());
  assert.equal(uncertain.outcome, "uncertain");
  assert.equal(posts, 1);
  const reloaded = controllerFor(state, fetch, { storage });
  const blocked = await reloaded.controller.submit(fields());
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.message, ORDER_MESSAGES.blocked);
  assert.equal(posts, 1);
  const retry = await reloaded.controller.retry();
  assert.equal(retry.outcome, "blocked");
  assert.equal(posts, 1);
});

test("a completed attempt stays separate from an explicitly requested new order", async () => {
  const posts = [];
  const state = { cart: basket(), access: "ready", pending: false };
  const { controller, keys } = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return csrf();
    posts.push(options.headers["idempotency-key"]);
    return { status: 201, _data: { success: true, order: orderRecord() } };
  });
  assert.equal((await controller.submit(fields())).outcome, "success");
  const repeat = await controller.submit(fields());
  assert.equal(repeat.outcome, "resolved");
  assert.equal(repeat.sent, false);
  assert.equal(posts.length, 1);
  assert.equal(controller.startNewOrder(), true);
  assert.equal((await controller.submit(fields())).outcome, "success");
  assert.equal(posts.length, 2);
  assert.equal(keys[0] === keys[1], false);
});

test("confirmation reads with GET and rejects an unauthorised or fabricated reference", async () => {
  const calls = [];
  const fetch = async (path, options) => {
    calls.push({ path, method: options.method });
    if (path.endsWith("/PV-HIDDEN")) return { status: 401, _data: { success: false, code: "CART_ACCESS_UNAVAILABLE" } };
    if (path.endsWith("/PV-MISSING")) return { status: 404, _data: { success: false, code: "ORDER_NOT_AVAILABLE" } };
    if (path.endsWith("/PV-BAD")) return { status: 200, _data: { success: true, order: { reference: "PV-BAD" } } };
    return { status: 200, _data: { success: true, order: orderRecord("PV-TEST") } };
  };
  assert.equal((await readOrderConfirmation(fetch, "x")).outcome, "unavailable");
  assert.equal(calls.length, 0);
  assert.equal((await readOrderConfirmation(fetch, "PV-HIDDEN")).outcome, "unavailable");
  assert.equal((await readOrderConfirmation(fetch, "PV-MISSING")).outcome, "unavailable");
  assert.equal((await readOrderConfirmation(fetch, "PV-BAD")).outcome, "service");
  const loaded = await readOrderConfirmation(fetch, "PV-TEST");
  const again = await readOrderConfirmation(fetch, "PV-TEST");
  assert.equal(loaded.outcome, "success");
  assert.equal(again.outcome, "success");
  assert.equal(loaded.order.full_total, "250.00");
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET", "GET"]);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
