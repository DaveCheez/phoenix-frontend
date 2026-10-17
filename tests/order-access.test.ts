import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createEvent } from "h3";

import type { CartConfig } from "../server/utils/cartConfig.ts";
import { issueCsrfToken } from "../server/utils/cartCsrf.ts";
import type { DjangoCall } from "../server/utils/cartActions.ts";
import { allowlistedOrder, handleCreateOrder, handleOrderConfirmation } from "../server/utils/orderActions.ts";

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

const customer = {
  customer_name: "Alex Farmer",
  customer_email: "alex@example.com",
  customer_phone: "01254 000000",
  vehicle_make: "Volkswagen",
  vehicle_model: "T6.1",
  vehicle_year: 2021,
  vehicle_wheelbase: "LWB",
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

async function call(
  handler: (event: ReturnType<typeof createEvent>, routeConfig: CartConfig, django: DjangoCall) => Promise<unknown>,
  input: { method: string; headers: Record<string, string>; body?: unknown; django: DjangoCall },
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
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
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
