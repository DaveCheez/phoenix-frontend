import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createEvent } from "h3";

import type { CartConfig } from "../server/utils/cartConfig.ts";
import { issueCsrfToken } from "../server/utils/cartCsrf.ts";
import type { DjangoCall } from "../server/utils/cartActions.ts";
import { allowlistedOrder, handleCreateOrder, handleOrderConfirmation, handleOrderList } from "../server/utils/orderActions.ts";

const SECRET = "ab".repeat(32);
const APP = "cd".repeat(32);
const GUEST = "A".repeat(43);

const config: CartConfig = {
  secret: SECRET,
  origin: "http://127.0.0.1",
  host: "127.0.0.1",
  dev: true,
  appCredential: APP,
  trustedIngress: "",
};

const REVIEW = "ab".repeat(32);

const customer = {
  customer_name: "Alex Farmer",
  customer_email: "alex@example.com",
  customer_phone: "01254 000000",
  vehicle_make: "Volkswagen",
  vehicle_model: "T6.1",
  vehicle_year: 2021,
  vehicle_wheelbase: "LWB",
  cart_review_token: REVIEW,
};

test("order bodies cannot carry prices", () => {
  assert.equal(allowlistedOrder({ ...customer, full_total: "1.00" }).ok, false);
  assert.equal(allowlistedOrder(customer).ok, true);
});

test("creating and reading an order use the guest credential, not a browser price", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const django: DjangoCall = async (input) => {
    calls.push(input);
    return {
      ok: true,
      status: input.method === "POST" ? 201 : 200,
      body: {
        success: true,
        order: {
          reference: "PV-TEST",
          full_total: "825.00",
          payment_status: "pending_deposit",
        },
      },
    };
  };
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const created = await call(handleCreateOrder, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `phoenix_guest_dev=${GUEST}`,
      "x-phoenix-csrf": csrf,
      "idempotency-key": "order-key-1",
    },
    body: { ...customer, deposit_required: "0.01" },
    django,
  });
  assert.equal(created.status, 400);
  assert.equal(calls.length, 0);

  const accepted = await call(handleCreateOrder, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `phoenix_guest_dev=${GUEST}`,
      "x-phoenix-csrf": csrf,
      "idempotency-key": "order-key-1",
    },
    body: customer,
    django,
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.json.order.reference, "PV-TEST");
  assert.equal(calls[0].bearer, GUEST);
  assert.equal(calls[0].idempotencyKey, "order-key-1");
  assert.equal((calls[0].body as Record<string, unknown>).full_total, undefined);
  assert.equal((calls[0].body as Record<string, unknown>).cart_review_token, REVIEW);

  const missingToken = { ...customer };
  delete (missingToken as { cart_review_token?: string }).cart_review_token;
  const rejected = await call(handleCreateOrder, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `phoenix_guest_dev=${GUEST}`,
      "x-phoenix-csrf": csrf,
      "idempotency-key": "order-key-2",
    },
    body: missingToken,
    django,
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.json.code, "CART_REVIEW_REQUIRED");
  assert.equal(calls.length, 1);

  const confirmation = await call(
    (event, routeConfig, upstream) => handleOrderConfirmation(event, routeConfig, upstream, "PV-TEST"),
    {
      method: "GET",
      headers: { cookie: `phoenix_guest_dev=${GUEST}` },
      django,
    },
  );
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.json.order.reference, "PV-TEST");
  assert.equal(calls[1].bearer, GUEST);
  assert.equal(calls[1].path, "orders/PV-TEST/");
});

test("order history is a validated guest list and does not start a session", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const summary = {
    reference: "PV-LIST1",
    created_at: "2026-11-18T17:05:08.123456+00:00",
    currency: "GBP",
    full_total: "250.00",
    payment_status: "pending_deposit",
  };
  const django: DjangoCall = async (input) => {
    calls.push(input);
    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        orders: [{ ...summary, customer_email: "hidden@example.com" }],
        page: 1,
        has_more: false,
        internal: true,
      },
    };
  };
  const listed = await call(handleOrderList, {
    method: "GET",
    path: "/?page=1",
    headers: { cookie: `phoenix_guest_dev=${GUEST}` },
    django,
  });
  assert.equal(listed.status, 502);
  assert.equal(listed.json.code, "ORDER_PROTOCOL_INCOMPATIBLE");
  assert.equal(calls[0].path, "orders/?page=1");
  assert.equal(calls[0].bearer, GUEST);
  assert.equal(calls[0].method, "GET");

  const accepted = await call(handleOrderList, {
    method: "GET",
    path: "/?page=1",
    headers: { cookie: `phoenix_guest_dev=${GUEST}` },
    django: async () => ({
      ok: true,
      status: 200,
      body: { success: true, orders: [summary], page: 1, has_more: true },
    }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.json.orders, [summary]);
  assert.equal(accepted.json.has_more, true);
  assert.equal(JSON.stringify(accepted.json).includes("customer_email"), false);

  const empty = await call(handleOrderList, {
    method: "GET",
    path: "/?page=2",
    headers: { cookie: `phoenix_guest_dev=${GUEST}` },
    django: async (input) => {
      calls.push(input);
      return { ok: true, status: 200, body: { success: true, orders: [], page: 2, has_more: false } };
    },
  });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.orders, []);
  assert.equal(calls.at(-1)?.path, "orders/?page=2");

  const anonymous = await call(handleOrderList, {
    method: "GET",
    path: "/?page=1",
    headers: {},
    django: async (input) => {
      calls.push(input);
      return { ok: true, status: 200, body: { success: true, orders: [], page: 1, has_more: false } };
    },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.code, "CART_SESSION_REQUIRED");
  assert.equal(calls.at(-1)?.path, "orders/?page=2");
});

async function call(
  handler: (event: ReturnType<typeof createEvent>, routeConfig: CartConfig, django: DjangoCall) => Promise<unknown>,
  input: { method: string; headers: Record<string, string>; body?: unknown; path?: string; django: DjangoCall },
) {
  let routeConfig = config;
  const server = createServer(async (req, res) => {
    const event = createEvent(req, res);
    const payload = await handler(event, routeConfig, input.django);
    if (!res.writableEnded) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  routeConfig = { ...config, origin: `http://127.0.0.1:${address.port}`, host: `127.0.0.1:${address.port}` };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${input.path || "/"}`, {
      method: input.method,
      headers: { origin: routeConfig.origin, ...input.headers },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve) => server.close(resolve));
  }
}
