import assert from "node:assert/strict";
import test from "node:test";

import {
  createCartController,
  setCartClientLog,
  UNCONFIRMED_MESSAGE,
} from "../utils/cartClient.js";

const CART_ID = "11111111-1111-1111-1111-111111111111";

function basket(quantity = 1, total = "10.00", itemCount = 1) {
  return {
    id: CART_ID,
    items: quantity == null ? [] : [{
      item_id: 7,
      name: "Rack",
      quantity,
      line_total: total,
    }],
    item_count: itemCount,
    total,
  };
}

function readyState(quantity = 1) {
  return { cart: basket(quantity), access: "ready", pending: false };
}

function mutex() {
  let tail = Promise.resolve();
  let depth = 0;
  return (task) => {
    const run = tail.then(async () => {
      depth += 1;
      if (depth !== 1) throw new Error("nested lock");
      try {
        return await task();
      } finally {
        depth -= 1;
      }
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

function controllerFor(state, fetch, extras = {}) {
  return createCartController({
    state,
    fetch,
    locksAvailable: () => true,
    lock: extras.lock || mutex(),
    schedule: extras.schedule,
    legacyPresent: () => false,
  });
}

test("simulated client: network exception without error.data is temporary and not a success", async () => {
  const state = readyState();
  let calls = 0;
  const controller = controllerFor(state, async (path) => {
    calls += 1;
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    throw new Error("network down");
  });
  await assert.rejects(controller.addToCart(3, 1, [4]), (error) => error.cartOutcome === "uncertain");
  assert.equal(state.access, "temporary");
  assert.equal(state.pending, false);
  assert.equal(state.cart.total, "10.00");
  assert.equal(calls, 2);
});

test("simulated client: timeout is temporary and is not retried", async () => {
  const state = readyState();
  let updates = 0;
  const controller = controllerFor(state, async (path) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    updates += 1;
    const error = new Error("timeout");
    error.name = "TimeoutError";
    throw error;
  });
  await assert.rejects(controller.setQuantity(7, 2), (error) => error.customerMessage === UNCONFIRMED_MESSAGE);
  assert.equal(updates, 1);
  assert.equal(state.access, "temporary");
});

test("simulated client: 429 and 5xx stay temporary without resetting the basket", async () => {
  for (const status of [429, 503]) {
    const state = readyState();
    const controller = controllerFor(state, async (path) => {
      if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
      return { status, _data: { success: false, code: "CART_ACCESS_UNAVAILABLE", error: "no" } };
    });
    await assert.rejects(controller.removeItem(7), (error) => error.cartOutcome === "uncertain");
    assert.equal(state.access, "temporary");
    assert.equal(state.cart.items[0].quantity, 1);
  }
});

test("simulated client: protocol and malformed success bodies are not applied", async () => {
  const bodies = [
    { status: 502, _data: { success: false, code: "CART_PROTOCOL_INCOMPATIBLE" } },
    { status: 200, _data: { success: true } },
    { status: 200, _data: { success: true, cart: {} } },
    { status: 200, _data: { success: true, cart: { ...basket(), items: "bad" } } },
    { status: 200, _data: { success: true, cart: { ...basket(), total: "10" } } },
    { status: 200, _data: { success: false, cart: basket(4, "40.00") } },
  ];
  for (const body of bodies) {
    const state = readyState();
    const controller = controllerFor(state, async (path) => {
      if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
      return body;
    });
    await assert.rejects(controller.addToCart(3, 1, []), (error) => error.cartOutcome === "uncertain");
    assert.equal(state.access, "temporary");
    assert.equal(state.cart.total, "10.00");
    assert.equal(state.cart.items[0].quantity, 1);
  }
});

test("simulated client: validated success replaces the basket", async () => {
  const state = readyState();
  const controller = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    assert.equal(options.retry, 0);
    return { status: 200, _data: { success: true, cart: basket(2, "20.00") } };
  });
  const result = await controller.addToCart(3, 1, [8]);
  assert.equal(result.ok, true);
  assert.equal(state.access, "ready");
  assert.equal(state.cart.total, "20.00");
  assert.equal(state.cart.items[0].quantity, 2);
});

test("simulated client: validation rejection keeps the confirmed basket and selected options", async () => {
  const state = readyState();
  const selected = [4, 9];
  const controller = controllerFor(state, async (path) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    return { status: 400, _data: { success: false, code: "MISSING_REQUIRED_OPTION", error: "raw upstream text" } };
  });
  await assert.rejects(controller.addToCart(3, 1, selected), (error) => {
    assert.equal(error.cartOutcome, "validation");
    assert.equal(error.customerMessage.includes("raw upstream"), false);
    return true;
  });
  assert.equal(state.access, "ready");
  assert.equal(state.cart.total, "10.00");
  assert.deepEqual(selected, [4, 9]);
});

test("simulated client: access and missing-cart responses keep their recovery states", async () => {
  const missing = readyState();
  const missingController = controllerFor(missing, async (path) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    return { status: 409, _data: { success: false, code: "GUEST_CART_MISSING" } };
  });
  await assert.rejects(missingController.removeItem(7));
  assert.equal(missing.access, "missing_cart");
  assert.equal(missing.cart, null);

  const unavailable = readyState();
  const unavailableController = controllerFor(unavailable, async (path) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    return { status: 401, _data: { success: false, code: "CART_ACCESS_UNAVAILABLE" } };
  });
  await assert.rejects(unavailableController.removeItem(7));
  assert.equal(unavailable.access, "access_unavailable");
});

test("simulated client: failed refresh does not restore ready", async () => {
  const state = readyState();
  state.access = "temporary";
  const controller = controllerFor(state, async () => ({ status: 503, _data: { success: false } }));
  await controller.refreshBasket();
  assert.equal(state.access, "temporary");
  assert.equal(state.cart.total, "10.00");
});

test("simulated client: explicit refresh is a GET and applies the returned cart", async () => {
  const state = readyState();
  state.access = "temporary";
  const methods = [];
  const controller = controllerFor(state, async (path, options) => {
    methods.push(options.method || "GET");
    assert.equal(path, "/api/cart");
    return { status: 200, _data: { success: true, cart: basket(3, "30.00") } };
  });
  await controller.refreshBasket();
  assert.deepEqual(methods, ["GET"]);
  assert.equal(state.access, "ready");
  assert.equal(state.cart.items[0].quantity, 3);
});

test("simulated scheduler: a pre-mutation read cannot erase temporary state", async () => {
  const state = readyState();
  let releaseRead;
  const gate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  let reads = 0;
  const controller = controllerFor(state, async (path, options) => {
    const method = options.method || "GET";
    if (path === "/api/cart" && method === "GET") {
      reads += 1;
      await gate;
      return { status: 200, _data: { success: true, cart: basket(9, "90.00") } };
    }
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    throw new Error("dispatched write failed");
  }, {
    schedule: (task) => task(),
    lock: (task) => task(),
  });
  const readPromise = controller.loadCart();
  await Promise.resolve();
  await assert.rejects(controller.addToCart(3, 1, []));
  assert.equal(state.access, "temporary");
  releaseRead();
  await readPromise;
  assert.equal(state.access, "temporary");
  assert.equal(state.cart.items[0].quantity, 1);
  assert.equal(reads, 1);
});

test("simulated client: a rejected action clears pending and leaves the queue usable", async () => {
  const state = readyState();
  let updates = 0;
  const controller = controllerFor(state, async (path) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    updates += 1;
    if (updates === 1) {
      return { status: 400, _data: { success: false, code: "INVALID_QUANTITY" } };
    }
    return { status: 200, _data: { success: true, cart: basket(2, "20.00") } };
  });
  await assert.rejects(controller.setQuantity(7, 4));
  assert.equal(state.pending, false);
  assert.equal(state.access, "ready");
  const result = await controller.setQuantity(7, 2);
  assert.equal(result.ok, true);
  assert.equal(state.pending, false);
  assert.equal(state.access, "ready");
});

test("simulated shared lock: cooperating clients read the latest quantity before posting", async () => {
  let quantity = 1;
  const posted = [];
  const lock = mutex();
  function fetch(path, options) {
    const method = options.method || "GET";
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    if (path === "/api/cart" && method === "GET") {
      return { status: 200, _data: { success: true, cart: basket(quantity, "10.00") } };
    }
    posted.push(options.body.quantity);
    quantity = options.body.quantity;
    return { status: 200, _data: { success: true, cart: basket(quantity, "10.00") } };
  }
  const first = controllerFor(readyState(1), fetch, { lock });
  const second = controllerFor(readyState(1), fetch, { lock });
  await Promise.all([
    first.adjustQuantity(7, 1),
    second.adjustQuantity(7, 1),
  ]);
  assert.deepEqual(posted, [2, 3]);
});

test("simulated shared lock: relative adjustment does not acquire the lock twice", async () => {
  const state = readyState(1);
  let depth = 0;
  let maxDepth = 0;
  const controller = controllerFor(state, async (path, options) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    if ((options.method || "GET") === "GET") {
      return { status: 200, _data: { success: true, cart: basket(1) } };
    }
    return { status: 200, _data: { success: true, cart: basket(2, "20.00") } };
  }, {
    lock: async (task) => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      try {
        return await task();
      } finally {
        depth -= 1;
      }
    },
  });
  await controller.adjustQuantity(7, 1);
  assert.equal(maxDepth, 1);
  assert.equal(state.cart.items[0].quantity, 2);
});

test("simulated shared lock: a removed line is not recreated", async () => {
  const state = readyState();
  const calls = [];
  const selected = [4];
  const controller = controllerFor(state, async (path, options) => {
    calls.push({ path, method: options.method || "GET" });
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-1" } };
    return { status: 200, _data: { success: true, cart: basket(null, "0.00", 0) } };
  });
  await assert.rejects(controller.adjustQuantity(7, 1), (error) => error.customerMessage === "This item is no longer in your basket.");
  assert.equal(calls.some((call) => call.path === "/api/cart/update" || call.path === "/api/cart/add"), false);
  assert.equal(state.access, "ready");
  assert.equal(state.cart.items.length, 0);
  assert.deepEqual(selected, [4]);
});

test("simulated client: clear sends one DELETE with an empty JSON body and CSRF", async () => {
  const state = readyState();
  const calls = [];
  const controller = controllerFor(state, async (path, options) => {
    calls.push({ path, ...options });
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: "csrf-clear" } };
    return { status: 200, _data: { success: true, cart: basket(null, "0.00", 0) } };
  });
  const result = await controller.clearCart();
  const clear = calls.filter((call) => call.path === "/api/cart/clear");
  assert.equal(result.ok, true);
  assert.equal(clear.length, 1);
  assert.equal(clear[0].method, "DELETE");
  assert.deepEqual(clear[0].body, {});
  assert.equal(clear[0].retry, 0);
  assert.equal(clear[0].headers["content-type"], "application/json");
  assert.equal(clear[0].headers["x-phoenix-csrf"], "csrf-clear");
  assert.equal(JSON.stringify(clear[0].body).includes("cart_id"), false);
});

test("simulated client: raw fetch errors and secret strings are absent from logs", async () => {
  const lines = [];
  setCartClientLog((line) => lines.push(line));
  const token = "DISTINCTIVE-GUEST-TOKEN";
  const state = readyState();
  const controller = controllerFor(state, async (path) => {
    if (path === "/api/cart/csrf") return { status: 200, _data: { success: true, csrf_token: token } };
    const error = new Error(`failed ${token}`);
    error.headers = { authorization: `Bearer ${token}`, "x-phoenix-csrf": token };
    throw error;
  });
  await assert.rejects(controller.addToCart(3, 1, []));
  const output = lines.join("\n");
  assert.equal(output.includes(token), false);
  assert.equal(output.includes("authorization"), false);
  assert.equal(output.includes("Bearer"), false);
  assert.match(output, /cart cart-add CART_SERVICE_UNAVAILABLE/);
  setCartClientLog(() => {});
});
