import assert from "node:assert/strict";
import test from "node:test";

import {
  createCartController,
  PREFLIGHT_MESSAGE,
  setCartClientLog,
  UNCONFIRMED_MESSAGE,
} from "../utils/cartClient.js";
import { runProductRecovery } from "../utils/productRecovery.js";

const CART_ID = "11111111-1111-1111-1111-111111111111";

function emptyBasket() {
  return {
    id: CART_ID,
    items: [],
    item_count: 0,
    total: "0.00",
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

function controllerFor(state, fetch) {
  return createCartController({
    state,
    fetch,
    locksAvailable: () => true,
    lock: mutex(),
    legacyPresent: () => false,
  });
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("product Start: denied CSRF preparation is visible and sends no create", async () => {
  setCartClientLog(() => {});
  const state = { cart: null, access: "not_started", pending: false };
  const selections = ["Enhanced", "None"];
  const calls = [];
  const toasts = [];
  let sawPending = false;
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on("unhandledRejection", onRejection);
  const controller = controllerFor(state, async (path) => {
    calls.push(path);
    sawPending = state.pending === true;
    return {
      status: 429,
      _data: { success: false, code: "CART_RATE_LIMITED", error: "raw upstream text" },
    };
  });
  const feedback = { value: "" };
  try {
    const result = await runProductRecovery({
      recover: () => controller.recoverBasket(),
      feedback,
    });
    await settle();
    assert.equal(result?.ok, false);
    assert.equal(feedback.value, PREFLIGHT_MESSAGE);
    assert.equal(feedback.value.includes("raw upstream"), false);
    assert.deepEqual(calls, ["/api/cart/csrf"]);
    assert.equal(state.access, "not_started");
    assert.equal(state.pending, false);
    assert.equal(sawPending, true);
    assert.equal(state.cart, null);
    assert.deepEqual(selections, ["Enhanced", "None"]);
    assert.deepEqual(toasts, []);
    assert.equal(rejections.length, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("product Start: a safe 503 during preparation is visible and is not retried", async () => {
  setCartClientLog(() => {});
  const state = { cart: null, access: "not_started", pending: false };
  const calls = [];
  const controller = controllerFor(state, async (path) => {
    calls.push(path);
    return { status: 503, _data: { success: false, code: "CART_TEMPORARILY_UNAVAILABLE", error: "hidden" } };
  });
  const feedback = { value: "stale" };
  const result = await runProductRecovery({
    recover: () => controller.recoverBasket(),
    feedback,
  });
  assert.equal(result?.ok, false);
  assert.equal(feedback.value, PREFLIGHT_MESSAGE);
  assert.equal(feedback.value.includes("hidden"), false);
  assert.deepEqual(calls, ["/api/cart/csrf"]);
  assert.equal(state.pending, false);
  assert.equal(state.access, "not_started");
});

test("product Start: a later explicit allowance clears the message without adding", async () => {
  setCartClientLog(() => {});
  const state = { cart: null, access: "not_started", pending: false };
  let csrfCalls = 0;
  const calls = [];
  const controller = controllerFor(state, async (path) => {
    calls.push(path);
    if (path === "/api/cart/csrf") {
      csrfCalls += 1;
      if (csrfCalls === 1) return { status: 429, _data: { success: false, code: "CART_RATE_LIMITED" } };
      return { status: 200, _data: { success: true, csrf_token: "csrf-ok" } };
    }
    return { status: 201, _data: { success: true, cart: emptyBasket() } };
  });
  const feedback = { value: "" };
  await runProductRecovery({ recover: () => controller.recoverBasket(), feedback });
  assert.equal(feedback.value, PREFLIGHT_MESSAGE);
  const started = await runProductRecovery({ recover: () => controller.recoverBasket(), feedback });
  assert.equal(started?.ok, true);
  assert.equal(feedback.value, "");
  assert.equal(state.access, "ready");
  assert.equal(state.pending, false);
  assert.deepEqual(calls, ["/api/cart/csrf", "/api/cart/csrf", "/api/cart/create"]);
});

test("product Start: a dispatched uncertain response stays uncertain", async () => {
  setCartClientLog(() => {});
  const state = { cart: null, access: "not_started", pending: false };
  const calls = [];
  const controller = controllerFor(state, async (path) => {
    calls.push(path);
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-ok" } };
    return { status: 503, _data: { success: false, code: "CART_TEMPORARILY_UNAVAILABLE", error: "hidden" } };
  });
  const feedback = { value: "" };
  const result = await runProductRecovery({ recover: () => controller.recoverBasket(), feedback });
  assert.equal(result?.ok, false);
  assert.equal(feedback.value, "");
  assert.notEqual(feedback.value, PREFLIGHT_MESSAGE);
  assert.equal(state.access, "temporary");
  assert.equal(state.pending, false);
  assert.deepEqual(calls, ["/api/cart/csrf", "/api/cart/create"]);
  assert.equal(UNCONFIRMED_MESSAGE.includes("not sent"), false);
});
