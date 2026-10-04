import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createEvent } from "h3";

import {
  handleAdd,
  handleClear,
  handleCreate,
  handleCsrf,
  handleGet,
  handleRemove,
  handleReset,
  handleUpdate,
  type DjangoCall,
} from "../server/utils/cartActions.ts";
import { isPlaceholderSecret, parseCartOrigin, type CartConfig } from "../server/utils/cartConfig.ts";
import { issueCsrfToken, verifyCsrfToken } from "../server/utils/cartCsrf.ts";
import { publicCart, readGuestCookie, validateIssuance } from "../server/utils/cartCookies.ts";
import {
  allowlistedAdd,
  csrfReadAllowed,
  mutationOriginAllowed,
} from "../server/utils/cartGuard.ts";
import { cartUpstream } from "../server/utils/cartTransport.ts";

const SECRET = "ab".repeat(32);
const GUEST = "A".repeat(43);
const OTHER_GUEST = "B".repeat(43);
const BOOTSTRAP = "cd".repeat(32);

const config: CartConfig = {
  secret: SECRET,
  origin: "http://localhost:3000",
  host: "localhost:3000",
  dev: true,
};

const cartBody = {
  id: "11111111-1111-1111-1111-111111111111",
  items: [
    {
      item_id: 7,
      name: "Rack",
      quantity: 2,
      line_total: "40.00",
      configured_unit_price: "20.00",
      selected_options: [
        {
          group_id: 1,
          group_name: "Colour",
          option_id: 4,
          option_name: "Black",
          price_adjustment: "0.00",
        },
      ],
      leaked: "do-not-copy",
    },
  ],
  item_count: 2,
  total: "40.00",
};

function futureIso(hours = 2): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function issued(token = GUEST) {
  return {
    ok: true as const,
    status: 201,
    body: {
      success: true,
      guest_access: { token, expires_at: futureIso() },
      cart: cartBody,
    },
  };
}

async function callRoute(
  handler: (event: ReturnType<typeof createEvent>, routeConfig: CartConfig, django: DjangoCall) => Promise<unknown> | unknown,
  input: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
    django?: DjangoCall;
    routeConfig?: CartConfig;
  },
) {
  const django = input.django || (async () => {
    throw new Error("Django stub was not expected");
  });
  let routeConfig = input.routeConfig || config;
  const server = createServer(async (req, res) => {
    const event = createEvent(req, res);
    const payload = await handler(event, routeConfig, django);
    if (!res.writableEnded) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${address.port}`;
  routeConfig = { ...routeConfig, origin, host: `127.0.0.1:${address.port}` };
  try {
    const headers = {
      origin,
      ...(input.headers || {}),
    };
    const response = await fetch(`${origin}${input.path || "/"}`, {
      method: input.method || "GET",
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      redirect: "manual",
    });
    const text = await response.text();
    return {
      status: response.status,
      cookies: response.headers.getSetCookie(),
      json: text ? JSON.parse(text) : null,
      text,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(resolve));
  }
}

function mutationHeaders(token: string, extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "x-phoenix-csrf": token,
    ...extra,
  };
}

test("origin and secret configuration reject anything except the explicit deployment", () => {
  assert.equal(isPlaceholderSecret(""), true);
  assert.equal(isPlaceholderSecret("a".repeat(64)), true);
  assert.equal(isPlaceholderSecret(SECRET), false);
  assert.equal(parseCartOrigin("http://localhost:3000", true)?.origin, "http://localhost:3000");
  assert.equal(parseCartOrigin("http://localhost:3000", false), null);
  assert.equal(parseCartOrigin("https://phoenixvanz.com", false)?.origin, "https://phoenixvanz.com");
  assert.equal(parseCartOrigin("https://www.phoenixvanz.com", false)?.origin, "https://www.phoenixvanz.com");
  assert.notEqual(
    parseCartOrigin("https://www.phoenixvanz.com", false)?.origin,
    parseCartOrigin("https://phoenixvanz.com", false)?.origin,
  );
  assert.equal(parseCartOrigin("https://preview.phoenixvanz.com.evil", false)?.hostname, "preview.phoenixvanz.com.evil");
  assert.equal(parseCartOrigin("http://127.0.0.1:3000/cart", true), null);
});

test("CSRF tokens expire, reject tampering, and stay bound to one session", () => {
  const now = 1_700_000_000_000;
  const token = issueCsrfToken({
    secret: SECRET,
    context: "guest",
    binding: GUEST,
    now,
  });
  assert.equal(token.includes(GUEST), false);
  assert.equal(verifyCsrfToken({ secret: SECRET, token, context: "guest", binding: GUEST, now }), true);
  assert.equal(verifyCsrfToken({ secret: SECRET, token, context: "guest", binding: OTHER_GUEST, now }), false);
  assert.equal(verifyCsrfToken({ secret: SECRET, token, context: "bootstrap", binding: GUEST, now }), false);
  assert.equal(verifyCsrfToken({ secret: SECRET, token: "", context: "guest", binding: GUEST, now }), false);
  assert.equal(verifyCsrfToken({
    secret: SECRET,
    token: token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
    context: "guest",
    binding: GUEST,
    now,
  }), false);
  assert.equal(verifyCsrfToken({
    secret: SECRET,
    token,
    context: "guest",
    binding: GUEST,
    now: now + 16 * 60 * 1000,
  }), false);
});

test("stub transport: exact origin checks reject cross-site and same-site requests", () => {
  const allowed = fakeEvent({
    host: "localhost:3000",
    origin: "http://localhost:3000",
  });
  const crossSite = fakeEvent({
    host: "localhost:3000",
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  });
  const sameSite = fakeEvent({
    host: "localhost:3000",
    "sec-fetch-site": "same-site",
    origin: "http://localhost:3000",
  });
  assert.equal(mutationOriginAllowed(allowed, config), true);
  assert.equal(mutationOriginAllowed(crossSite, config), false);
  assert.equal(csrfReadAllowed(fakeEvent({
    host: "localhost:3000",
    "x-phoenix-csrf-request": "1",
    "sec-fetch-site": "same-origin",
  }), config), true);
  assert.equal(csrfReadAllowed(crossSite, config), false);
  assert.equal(csrfReadAllowed(sameSite, config), false);
  assert.equal(mutationOriginAllowed(fakeEvent({ host: "localhost:3000" }), config), false);
});

test("stub transport: GET does not start a cart and reports a legacy marker only", async () => {
  let calls = 0;
  const result = await callRoute(handleGet, {
    headers: { cookie: "cart_id=old-uuid" },
    django: async () => {
      calls += 1;
      throw new Error("GET must not call Django without a guest cookie");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, 401);
  assert.equal(result.json.code, "CART_SESSION_REQUIRED");
  assert.equal(result.json.legacy_marker, true);
});

test("stub transport: issuance stays in the cookie and out of browser JSON", async () => {
  const bootstrap = issueCsrfToken({ secret: SECRET, context: "bootstrap", binding: BOOTSTRAP });
  const result = await callRoute(handleCreate, {
    method: "POST",
    headers: mutationHeaders(bootstrap, { cookie: `phoenix_cart_bootstrap_dev=${BOOTSTRAP}` }),
    body: { action: "start", cart_id: "attacker", authorization: "Bearer no" },
    django: async (input) => {
      assert.equal(input.bearer, undefined);
      assert.deepEqual(input.body, { action: "start" });
      return issued();
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.text.includes(GUEST), false);
  assert.equal(result.text.includes("guest_access"), false);
  assert.equal(result.json.cart.total, "40.00");
  assert.equal(result.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), true);
  const guestCookie = result.cookies.find((cookie) => cookie.startsWith("phoenix_guest_dev=")) || "";
  assert.match(guestCookie, /HttpOnly/i);
  assert.match(guestCookie, /Path=\//);
  assert.match(guestCookie, /SameSite=Lax/i);
  assert.doesNotMatch(guestCookie, /Domain=/i);
  assert.doesNotMatch(guestCookie, /Secure/i);
  assert.match(guestCookie, /Max-Age=([0-9]+)/);
  const maxAge = Number(guestCookie.match(/Max-Age=([0-9]+)/)?.[1]);
  assert.ok(maxAge > 0 && maxAge <= 2 * 60 * 60);
});

test("stub transport: a production cookie is Secure and a dev cookie is not a production credential", async () => {
  assert.equal(readGuestCookie(`phoenix_guest_dev=${GUEST}`, false).status, "absent");
  assert.equal(readGuestCookie(`phoenix_guest_dev=${GUEST}; phoenix_guest_dev=${OTHER_GUEST}`, true).status, "ambiguous");
  const bootstrap = issueCsrfToken({ secret: SECRET, context: "bootstrap", binding: BOOTSTRAP });
  const result = await callRoute(handleCreate, {
    method: "POST",
    routeConfig: { ...config, dev: false },
    headers: mutationHeaders(bootstrap, { cookie: `__Host-phoenix_cart_bootstrap=${BOOTSTRAP}` }),
    body: { action: "start" },
    django: async () => issued(),
  });
  const guestCookie = result.cookies.find((cookie) => cookie.startsWith("__Host-phoenix_guest=")) || "";
  assert.match(guestCookie, /Secure/i);
  assert.match(guestCookie, /HttpOnly/i);
  assert.doesNotMatch(guestCookie, /Domain=/i);
});

test("stub transport: browser authorization and cart ids cannot select another basket", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const result = await callRoute(handleAdd, {
    method: "POST",
    headers: mutationHeaders(csrf, {
      cookie: `phoenix_guest_dev=${GUEST}`,
      authorization: `Bearer ${OTHER_GUEST}`,
    }),
    body: {
      product_id: 5,
      quantity: 1,
      options: [4, 9],
      cart_id: "other-cart",
      price: "1.00",
      total: "1.00",
    },
    django: async (input) => {
      assert.equal(input.bearer, GUEST);
      assert.deepEqual(input.body, { product_id: 5, quantity: 1, options: [4, 9] });
      return { ok: true, status: 200, body: { success: true, cart: cartBody } };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.cart.total, "40.00");
  assert.equal(result.json.cart.items[0].line_total, "40.00");
  assert.equal(result.json.cart.items[0].leaked, undefined);
  assert.equal(JSON.stringify(result.json).includes(GUEST), false);
});

test("stub transport: replacement preserves the credential and does not send a cart id", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const result = await callRoute(handleCreate, {
    method: "POST",
    headers: mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` }),
    body: { action: "replace_missing", cart_id: "ignored" },
    django: async (input) => {
      assert.equal(input.path, "cart/create/");
      assert.deepEqual(input.body, { action: "replace_missing" });
      assert.equal(input.bearer, GUEST);
      return { ok: true, status: 201, body: { success: true, cart: { ...cartBody, items: [], item_count: 0, total: "0.00" } } };
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.cookies.some((cookie) => cookie.includes("phoenix_guest_dev=")), false);
  assert.equal(result.json.cart.total, "0.00");
});

test("stub transport: reset forgets only a definitive unavailable credential", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const headers = mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` });

  const refused = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => ({ ok: true, status: 200, body: { success: true, cart: cartBody } }),
  });
  assert.equal(refused.json.code, "CART_STILL_AVAILABLE");
  assert.equal(refused.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);

  const missing = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => ({
      ok: false,
      status: 409,
      code: "GUEST_CART_MISSING",
      error: "This guest session has no cart.",
      category: "upstream",
    }),
  });
  assert.equal(missing.status, 409);
  assert.equal(missing.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);

  const unavailable = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => ({
      ok: false,
      status: 401,
      code: "CART_ACCESS_UNAVAILABLE",
      error: "Cart access is not available.",
      category: "upstream",
    }),
  });
  assert.equal(unavailable.json.code, "CART_SESSION_RESET");
  assert.equal(unavailable.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), true);

  let calls = 0;
  const temporary = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => {
      calls += 1;
      return { ok: false, status: 503, code: "CART_SERVICE_UNAVAILABLE", error: "down", category: "unavailable" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(temporary.status, 503);
  assert.equal(temporary.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);
});

test("stub transport: upstream failures stay generic and are not retried", async () => {
  let calls = 0;
  const redirect = await cartUpstream({
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, `Bearer ${GUEST}`);
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: `https://evil.example/${GUEST}` } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(redirect.ok, false);
  assert.equal(JSON.stringify(redirect).includes(GUEST), false);

  const leaked = await cartUpstream({
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    fetchImpl: async () => new Response(JSON.stringify({ code: "INVALID_OPTION", error: `bad ${GUEST}` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(leaked.ok, false);
  if (!leaked.ok) {
    assert.equal(leaked.code, "INVALID_OPTION");
    assert.equal(leaked.error.includes(GUEST), false);
  }

  const crashed = await cartUpstream({
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    fetchImpl: async () => {
      throw new Error(`network ${GUEST}`);
    },
  });
  assert.equal(crashed.ok, false);
  assert.equal(JSON.stringify(crashed).includes(GUEST), false);
});

test("option arrays and configured totals are preserved without browser prices", () => {
  const allowed = allowlistedAdd({
    product_id: 3,
    quantity: 2,
    options: [8, 9],
    cart_id: "nope",
    price: "1.00",
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.deepEqual(allowed.body.options, [8, 9]);
  const published = publicCart(cartBody);
  assert.equal(published?.total, "40.00");
  assert.equal((published?.items as Array<Record<string, unknown>>)[0].line_total, "40.00");
  const oldBackend = validateIssuance({ success: true, cart_id: "uuid-only", cart: cartBody });
  assert.equal(oldBackend.ok, false);
});

test("a bootstrap token cannot be reused after a guest cookie exists", async () => {
  const bootstrap = issueCsrfToken({ secret: SECRET, context: "bootstrap", binding: BOOTSTRAP });
  const result = await callRoute(handleCreate, {
    method: "POST",
    headers: mutationHeaders(bootstrap, {
      cookie: `phoenix_guest_dev=${GUEST}; phoenix_cart_bootstrap_dev=${BOOTSTRAP}`,
    }),
    body: { action: "start" },
    django: async () => {
      throw new Error("bootstrap CSRF must not start over an existing guest cookie");
    },
  });
  assert.equal(result.status, 403);
});

test("CSRF retrieval does not issue a Django session", async () => {
  let calls = 0;
  const result = await callRoute(handleCsrf, {
    headers: {
      "x-phoenix-csrf-request": "1",
      "sec-fetch-site": "same-origin",
    },
    django: async () => {
      calls += 1;
      throw new Error("CSRF must not call Django");
    },
  });
  assert.equal(calls, 0);
  assert.equal(typeof result.json.csrf_token, "string");
  assert.equal(result.text.includes(GUEST), false);
  assert.equal(result.cookies.some((cookie) => cookie.startsWith("phoenix_cart_bootstrap_dev=")), true);
});

test("stub transport: clear, update and remove keep valid carts and safe validation failures", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const headers = mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` });

  const cleared = await callRoute(handleClear, {
    method: "DELETE",
    headers,
    body: {},
    django: async (input) => {
      assert.equal(input.path, "cart/clear/");
      assert.equal(input.method, "DELETE");
      assert.equal(input.bearer, GUEST);
      assert.equal(input.body, undefined);
      return { ok: true, status: 200, body: { success: true, cart: cartBody } };
    },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.cart.total, "40.00");

  const updated = await callRoute(handleUpdate, {
    method: "POST",
    headers,
    body: { item_id: 7, quantity: 2, cart_id: "other", price: "1.00" },
    django: async (input) => {
      assert.deepEqual(input.body, { item_id: 7, quantity: 2 });
      assert.equal(input.bearer, GUEST);
      return { ok: true, status: 200, body: { success: true, cart: cartBody } };
    },
  });
  assert.equal(updated.json.cart.line_total, undefined);
  assert.equal(updated.json.cart.total, "40.00");

  const rejected = await callRoute(handleUpdate, {
    method: "POST",
    headers,
    body: { item_id: 7, quantity: 1000 },
    django: async () => {
      throw new Error("invalid quantity must not reach Django");
    },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.json.code, "INVALID_QUANTITY");

  const removed = await callRoute(handleRemove, {
    method: "POST",
    headers,
    body: { item_id: 7, cart_id: "other" },
    django: async (input) => {
      assert.deepEqual(input.body, { item_id: 7 });
      return { ok: true, status: 200, body: { success: true, cart: { ...cartBody, items: [], item_count: 0, total: "0.00" } } };
    },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.cart.total, "0.00");
});

function fakeEvent(headers: Record<string, string>) {
  const raw: string[] = [];
  const req = new (class {
    rawHeaders = raw;
    headers: Record<string, string> = {};
  })();
  for (const [key, value] of Object.entries(headers)) {
    raw.push(key, value);
    req.headers[key.toLowerCase()] = value;
  }
  return { node: { req } } as unknown as ReturnType<typeof createEvent>;
}
