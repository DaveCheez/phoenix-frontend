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
  createOrderHistory,
  orderHistoryLost,
  readOrderConfirmation,
  readOrderList,
  validateOrderList,
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
    syncBasket: extras.syncBasket,
    cartState: () => state,
    onSavedOrder: extras.onSavedOrder,
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

function summary(reference = "PV-LIST1") {
  return {
    reference,
    created_at: "2026-11-18T17:05:08+00:00",
    currency: "GBP",
    full_total: "250.00",
    payment_status: "pending_deposit",
  };
}

test("your orders links follow saved orders rather than the basket or feature flags", () => {
  const navbar = readFileSync(new URL("../components/Navbar.vue", import.meta.url), "utf8");
  const cart = readFileSync(new URL("../pages/cart.vue", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../pages/orders.vue", import.meta.url), "utf8");
  const confirmation = readFileSync(new URL("../pages/order-confirmation.vue", import.meta.url), "utf8");
  const submission = readFileSync(new URL("../composables/useOrderSubmission.js", import.meta.url), "utf8");
  const desktop = navbar.slice(0, navbar.indexOf('id="mobile-menu"'));
  const mobile = navbar.slice(navbar.indexOf('id="mobile-menu"'));
  const emptyBasket = cart.slice(cart.indexOf("Your cart is empty."));
  assert.equal((desktop.match(/v-if="showSavedOrders"/g) || []).length, 1);
  assert.equal((mobile.match(/v-if="showSavedOrders"/g) || []).length, 1);
  assert.equal((desktop.match(/to="\/orders"/g) || []).length, 1);
  assert.equal((mobile.match(/to="\/orders"/g) || []).length, 1);
  assert.match(desktop, /Your orders/);
  assert.match(mobile, /Your orders/);
  assert.equal(navbar.includes("orderSubmissionEnabled"), false);
  assert.equal(navbar.includes("localStorage"), false);
  assert.match(emptyBasket, /v-if="showSavedOrders"/);
  assert.match(emptyBasket, /View your submitted orders/);
  assert.match(emptyBasket, /Continue Shopping/);
  assert.equal(emptyBasket.includes("cartItemCount"), false);
  assert.equal(orders.includes("startNewBasket"), false);
  assert.equal(orders.includes("openEmptyBasket"), false);
  assert.equal(orders.includes("/api/cart"), false);
  assert.equal(orders.includes("readOrderList"), false);
  assert.match(orders, /useOrderHistory/);
  assert.match(orders, /current guest session/);
  assert.match(orders, /another device/);
  assert.match(orders, /You have no submitted orders in this browser session/);
  assert.match(orders, /Your orders could not be loaded/);
  assert.match(orders, /Orders are not available/);
  assert.match(confirmation, /readConfirmation/);
  assert.equal(confirmation.includes("useCart"), false);
  assert.match(submission, /onSavedOrder/);
  assert.equal(orderHistoryLost("not_started"), true);
  assert.equal(orderHistoryLost("legacy"), true);
  assert.equal(orderHistoryLost("access_unavailable"), true);
  assert.equal(orderHistoryLost("ready"), false);
  assert.equal(orderHistoryLost("missing_cart"), false);
  assert.equal(orderHistoryLost("temporary"), false);
  assert.equal(orderHistoryLost("loading"), false);
});

test("order list validation keeps pages separate from an empty history", async () => {
  const row = summary();
  assert.equal(validateOrderList({ success: true, orders: [], page: 1, has_more: false }, 1).orders.length, 0);
  assert.equal(validateOrderList({ success: true, orders: [row], page: 1, has_more: false, note: "x" }, 1), null);
  assert.equal(validateOrderList({ success: true, orders: [{ ...row, customer_email: "a@b.c" }], page: 1, has_more: false }, 1), null);
  assert.equal(validateOrderList({ success: true, orders: [{ ...row, full_total: "250" }], page: 1, has_more: false }, 1), null);
  const calls = [];
  const fetch = async (path, options) => {
    calls.push({ path, method: options.method, retry: options.retry });
    if (path.endsWith("page=9")) return { status: 503, _data: { success: false, code: "CART_SERVICE_UNAVAILABLE" } };
    if (path.endsWith("page=8")) return { status: 401, _data: { success: false, code: "CART_SESSION_REQUIRED" } };
    if (path.endsWith("page=2")) return { status: 200, _data: { success: true, orders: [], page: 2, has_more: false } };
    return { status: 200, _data: { success: true, orders: [row, summary("PV-LIST2")], page: 1, has_more: true } };
  };
  const first = await readOrderList(fetch, 1);
  const blank = await readOrderList(fetch, 2);
  const denied = await readOrderList(fetch, 8);
  const failed = await readOrderList(fetch, 9);
  assert.equal(first.outcome, "success");
  assert.equal(first.list.has_more, true);
  assert.equal(first.list.orders[1].reference, "PV-LIST2");
  assert.equal(blank.outcome, "empty");
  assert.equal(denied.outcome, "unavailable");
  assert.equal(failed.outcome, "service");
  assert.notEqual(failed.message, ORDER_MESSAGES.listEmpty);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET"]);
  assert.equal(calls.every((call) => call.retry === 0), true);
});

test("saved confirmation is independent of the basket and a failed refresh stays a success", async () => {
  const confirmation = readFileSync(new URL("../pages/order-confirmation.vue", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../pages/checkout.vue", import.meta.url), "utf8");
  assert.equal(confirmation.includes("useCart"), false);
  assert.equal(confirmation.includes("router.push"), false);
  assert.match(checkout, /You have already submitted this order\./);
  assert.match(checkout, /Changes to your basket apply only to a new order\./);
  assert.match(checkout, /View submitted order/);
  assert.match(checkout, /Start another order from this basket/);
  assert.match(checkout, /Continue shopping/);
  const mounted = checkout.slice(checkout.lastIndexOf("onMounted"));
  assert.equal(mounted.includes("startNewOrder"), false);
  const posts = [];
  let depth = 0;
  const state = { cart: basket(), access: "ready", pending: false };
  const { controller, keys } = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return csrf();
    posts.push({ path, method: options.method, body: options.body, key: options.headers["idempotency-key"] });
    if (posts.length === 1) throw new Error("response withheld");
    return { status: 200, _data: { success: true, order: orderRecord("PV-SAME") } };
  }, {
    lock: async (task) => {
      depth += 1;
      if (depth !== 1) throw new Error("nested lock");
      try {
        return await task();
      } finally {
        depth -= 1;
      }
    },
    syncBasket: async () => {
      state.depthAtSync = depth;
      state.cart = { ...basket(), items: [{ ...basket().items[0], name: "Next product" }], total: "60.00" };
      return { ok: true };
    },
  });
  const lost = await controller.submit(fields());
  assert.equal(lost.outcome, "uncertain");
  state.cart = { ...basket(), items: [], total: "0.00" };
  const replayed = await controller.retry();
  assert.equal(replayed.outcome, "success");
  assert.equal(replayed.order.reference, "PV-SAME");
  assert.equal(posts[0].key, posts[1].key);
  assert.equal(posts[1].body.cart_review_token, TOKEN);
  assert.equal(posts[1].body.customer_name, "Alex Farmer");
  assert.equal(state.depthAtSync, 0);
  assert.equal(state.cart.items[0].name, "Next product");
  assert.equal(posts.some((call) => String(call.path).includes("clear")), false);
  assert.equal(keys.length, 1);

  const failedRefresh = controllerFor({ cart: basket(), access: "ready", pending: false }, async (path) => {
    if (path === "/api/cart/csrf") return csrf();
    return { status: 201, _data: { success: true, order: orderRecord("PV-WARN") } };
  }, { syncBasket: async () => ({ ok: false }) });
  const warned = await failedRefresh.controller.submit(fields());
  assert.equal(warned.outcome, "success");
  assert.equal(warned.order.reference, "PV-WARN");
  assert.match(warned.basketWarning, /basket could not be refreshed/);
  assert.equal(failedRefresh.controller.status().reference, "PV-WARN");
  assert.equal(failedRefresh.controller.status().phase, "resolved");
  assert.equal((await failedRefresh.controller.submit(fields())).sent, false);
});

function listed(orders, page = 1, hasMore = false) {
  return { status: 200, _data: { success: true, orders, page, has_more: hasMore } };
}

test("no session and an empty first page keep the order links hidden", async () => {
  const paths = [];
  const absent = createOrderHistory({
    state: { phase: "unknown" },
    fetch: async (path, options) => {
      paths.push(path);
      assert.equal(options.method, "GET");
      return { status: 401, _data: { success: false, code: "CART_SESSION_REQUIRED" } };
    },
  });
  assert.equal(absent.show(), false);
  const denied = await absent.read(1);
  assert.equal(denied.outcome, "unavailable");
  assert.equal(absent.show(), false);
  assert.equal(absent.phase(), "none");
  assert.deepEqual(paths, ["/api/orders?page=1"]);

  const empty = createOrderHistory({
    state: { phase: "unknown" },
    fetch: async () => listed([]),
  });
  const blank = await empty.read(1);
  assert.equal(blank.outcome, "empty");
  assert.equal(empty.show(), false);
  assert.equal(empty.phase(), "none");

  const later = createOrderHistory({
    state: { phase: "saved" },
    fetch: async () => listed([], 2),
  });
  await later.read(2);
  assert.equal(later.show(), true);
  assert.equal(later.phase(), "saved");
});

test("the first saved order shows the menus and an empty basket keeps them", async () => {
  const history = createOrderHistory({
    state: { phase: "unknown" },
    fetch: async () => {
      throw new Error("order links must not wait for another list read");
    },
  });
  const state = { cart: basket(), access: "ready", pending: false };
  const { controller } = controllerFor(state, async (path) => {
    if (path === "/api/cart/csrf") return csrf();
    return { status: 201, _data: { success: true, order: orderRecord("PV-FIRST") } };
  }, {
    syncBasket: async () => {
      state.cart = { ...basket(), items: [], item_count: 0, total: "0.00" };
      return { ok: true };
    },
    onSavedOrder: () => history.noteSavedOrder(),
  });
  assert.equal(history.show(), false);
  const saved = await controller.submit(fields());
  assert.equal(saved.outcome, "success");
  assert.equal(saved.order.reference, "PV-FIRST");
  assert.equal(state.cart.items.length, 0);
  assert.equal(history.show(), true);
});

test("a full reload restores order links from the authenticated list", async () => {
  let calls = 0;
  const fetch = async (path, options) => {
    calls += 1;
    assert.equal(path, "/api/orders?page=1");
    assert.equal(options.method, "GET");
    return listed([summary("PV-RELOAD")]);
  };
  const first = createOrderHistory({ state: { phase: "unknown" }, fetch });
  assert.equal(first.show(), false);
  await first.read(1);
  assert.equal(first.show(), true);
  const reloaded = createOrderHistory({ state: { phase: "unknown" }, fetch });
  assert.equal(reloaded.show(), false);
  await reloaded.read(1);
  assert.equal(reloaded.show(), true);
  assert.equal(calls, 2);
});

test("a temporary list failure keeps order links for the same session", async () => {
  let mode = "ok";
  const history = createOrderHistory({
    state: { phase: "unknown" },
    fetch: async () => (
      mode === "fail"
        ? { status: 503, _data: { success: false, code: "CART_SERVICE_UNAVAILABLE" } }
        : listed([summary("PV-KEEP")])
    ),
  });
  await history.read(1);
  assert.equal(history.show(), true);
  mode = "fail";
  const failed = await history.read(1, { refresh: true });
  assert.equal(failed.outcome, "service");
  assert.notEqual(failed.message, ORDER_MESSAGES.listEmpty);
  assert.equal(history.show(), true);
});

test("replacing or expiring the guest session clears order links and ignores a late list", async () => {
  let release;
  const history = createOrderHistory({
    state: { phase: "unknown" },
    fetch: () => new Promise((resolve) => {
      release = () => resolve(listed([summary("PV-STALE")]));
    }),
  });
  const pending = history.read(1);
  history.noteSavedOrder();
  history.loseSession();
  release();
  const late = await pending;
  assert.equal(late.stale, true);
  assert.equal(history.show(), false);

  const expired = createOrderHistory({
    state: { phase: "saved" },
    fetch: async () => ({ status: 401, _data: { success: false, code: "CART_ACCESS_UNAVAILABLE" } }),
  });
  const denial = await expired.read(1, { refresh: true });
  assert.equal(denial.outcome, "unavailable");
  assert.equal(expired.show(), false);

  let confirmRelease;
  const confirmed = createOrderHistory({
    state: { phase: "saved" },
    fetch: () => new Promise((resolve) => {
      confirmRelease = () => resolve({
        status: 200,
        _data: { success: true, order: orderRecord("PV-HIDDEN") },
      });
    }),
  });
  const confirmation = confirmed.readConfirmation("PV-HIDDEN");
  confirmed.loseSession();
  confirmRelease();
  const hidden = await confirmation;
  assert.equal(hidden.stale, true);
  assert.equal(confirmed.show(), false);

  const foreign = createOrderHistory({
    state: { phase: "saved" },
    fetch: async () => ({ status: 404, _data: { success: false, code: "ORDER_NOT_AVAILABLE" } }),
  });
  const missed = await foreign.readConfirmation("PV-OTHER");
  assert.equal(missed.outcome, "unavailable");
  assert.equal(missed.stale, undefined);
  assert.equal(foreign.show(), true);
});

test("the orders page and navigation share one current first page", async () => {
  let calls = 0;
  const history = createOrderHistory({
    state: { phase: "unknown" },
    fetch: async () => {
      calls += 1;
      return listed([summary("PV-ONCE")]);
    },
  });
  const [first, second] = await Promise.all([history.read(1), history.read(1)]);
  await history.read(1);
  assert.equal(calls, 1);
  assert.equal(first.outcome, "success");
  assert.equal(second.list.orders[0].reference, "PV-ONCE");
  assert.equal(history.show(), true);
});

test("an older empty page cannot hide an order saved while it was loading", async () => {
  let release;
  const history = createOrderHistory({
    state: { phase: "unknown" },
    fetch: () => new Promise((resolve) => {
      release = () => resolve(listed([]));
    }),
  });
  const pending = history.read(1);
  history.noteSavedOrder();
  release();
  const older = await pending;
  assert.equal(older.stale, true);
  assert.equal(history.show(), true);
});

test("an authenticated order establishes saved orders for this guest", async () => {
  const history = createOrderHistory({
    state: { phase: "unknown" },
    fetch: async (path, options) => {
      assert.equal(options.method, "GET");
      assert.equal(path, "/api/orders/PV-SEEN");
      return { status: 200, _data: { success: true, order: orderRecord("PV-SEEN") } };
    },
  });
  const seen = await history.readConfirmation("PV-SEEN");
  assert.equal(seen.outcome, "success");
  assert.equal(seen.stale, undefined);
  assert.equal(history.show(), true);
});
