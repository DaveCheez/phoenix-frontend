import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createCartController,
  PREFLIGHT_MESSAGE,
  setCartClientLog,
} from "../utils/cartClient.js";
import { runProductRecovery } from "../utils/productRecovery.js";

const CART_ID = "11111111-1111-1111-1111-111111111111";

function emptyBasket() {
  return { id: CART_ID, items: [], item_count: 0, total: "0.00" };
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

test("cart page Start binds the notice to the existing preparation helper", () => {
  const source = readFileSync(new URL("../pages/cart.vue", import.meta.url), "utf8");
  assert.match(source, /import \{ runProductRecovery \} from "~\/utils\/productRecovery"/);
  assert.match(source, /const recoverFromNotice = async \(\) => \{/);
  assert.match(source, /await runProductRecovery\(\{[\s\S]*recover: \(\) => recoverBasket\(\),[\s\S]*feedback: recoveryFeedback,/);
  assert.match(source, /:feedback="recoveryFeedback"/);
  assert.match(source, /@action="recoverFromNotice"/);
  assert.equal(source.includes('@action="recoverBasket"'), false);
});

test("cart Start callback: denied CSRF preparation is visible and a later start clears it", async () => {
  setCartClientLog(() => {});
  const state = { cart: null, access: "not_started", pending: false };
  let csrfCalls = 0;
  const calls = [];
  let sawPending = false;
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on("unhandledRejection", onRejection);
  const controller = controllerFor(state, async (path) => {
    calls.push(path);
    sawPending = state.pending === true;
    if (path === "/api/cart/csrf") {
      csrfCalls += 1;
      if (csrfCalls === 1) {
        return { status: 429, _data: { success: false, code: "CART_RATE_LIMITED", error: "raw upstream text" } };
      }
      return { status: 200, _data: { success: true, csrf_token: "csrf-ok" } };
    }
    return { status: 201, _data: { success: true, cart: emptyBasket() } };
  });
  const feedback = { value: "" };
  try {
    const denied = await runProductRecovery({
      recover: () => controller.recoverBasket(),
      feedback,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(denied?.ok, false);
    assert.equal(feedback.value, PREFLIGHT_MESSAGE);
    assert.equal(feedback.value.includes("raw upstream"), false);
    assert.deepEqual(calls, ["/api/cart/csrf"]);
    assert.equal(state.access, "not_started");
    assert.equal(state.pending, false);
    assert.equal(sawPending, true);
    assert.equal(rejections.length, 0);

    const started = await runProductRecovery({
      recover: () => controller.recoverBasket(),
      feedback,
    });
    assert.equal(started?.ok, true);
    assert.equal(feedback.value, "");
    assert.equal(state.access, "ready");
    assert.equal(state.pending, false);
    assert.deepEqual(calls, ["/api/cart/csrf", "/api/cart/csrf", "/api/cart/create"]);
    assert.equal(calls.includes("/api/cart/add"), false);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("cart Start callback: a dispatched uncertain response is not labelled not sent", async () => {
  setCartClientLog(() => {});
  const state = { cart: null, access: "not_started", pending: false };
  const calls = [];
  const controller = controllerFor(state, async (path) => {
    calls.push(path);
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-ok" } };
    return { status: 503, _data: { success: false, code: "CART_TEMPORARILY_UNAVAILABLE" } };
  });
  const feedback = { value: "" };
  const result = await runProductRecovery({
    recover: () => controller.recoverBasket(),
    feedback,
  });
  assert.equal(result?.ok, false);
  assert.equal(feedback.value, "");
  assert.equal(state.access, "temporary");
  assert.equal(state.pending, false);
  assert.deepEqual(calls, ["/api/cart/csrf", "/api/cart/create"]);
});
