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
import { isAppCredential, isPlaceholderSecret, parseCartOrigin, type CartConfig } from "../server/utils/cartConfig.ts";
import { issueCsrfToken, verifyCsrfToken } from "../server/utils/cartCsrf.ts";
import { publicCart, readGuestCookie, validateIssuance } from "../server/utils/cartCookies.ts";
import {
  allowlistedAdd,
  csrfReadAllowed,
  mutationOriginAllowed,
} from "../server/utils/cartGuard.ts";
import {
  classifyBudgetResponse,
  isBudgetOperation,
  sendCartBudget,
} from "../server/utils/cartBudget.ts";
import {
  cartUpstream,
  classifyUpstream,
  credentialUpstreamAllowed,
  DEVELOPMENT_SHOPPER_ADDRESS,
  dispatchCartUpstream,
  parseRetryAfterHeader,
  selectShopperAddress,
} from "../server/utils/cartTransport.ts";

const SECRET = "ab".repeat(32);
const APP = "cd".repeat(32);
const ADDRESS = "203.0.113.10";
const GUEST = "A".repeat(43);
const OTHER_GUEST = "B".repeat(43);
const BOOTSTRAP = "cd".repeat(32);

const config: CartConfig = {
  secret: SECRET,
  origin: "http://localhost:3000",
  host: "localhost:3000",
  dev: true,
  appCredential: APP,
  trustedIngress: "",
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

function allowedBudgetResponse() {
  return new Response(JSON.stringify({ success: true, code: "CART_BUDGET_ALLOWED" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function callRoute(
  handler: (
    event: ReturnType<typeof createEvent>,
    routeConfig: CartConfig,
    django: DjangoCall,
    transport: { baseUrl: string; fetchImpl?: typeof fetch },
  ) => Promise<unknown> | unknown,
  input: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
    django?: DjangoCall;
    routeConfig?: CartConfig;
    budgetFetch?: typeof fetch;
  },
) {
  const django = input.django || (async () => {
    throw new Error("Django stub was not expected");
  });
  const transport = {
    baseUrl: "http://127.0.0.1:9/api",
    fetchImpl: input.budgetFetch || (async () => allowedBudgetResponse()),
  };
  let routeConfig = input.routeConfig || config;
  const server = createServer(async (req, res) => {
    const event = createEvent(req, res);
    const payload = await handler(event, routeConfig, django, transport);
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
      retryAfter: response.headers.get("retry-after"),
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
  assert.equal(isAppCredential(""), false);
  assert.equal(isAppCredential("a".repeat(64)), false);
  assert.equal(isAppCredential(SECRET.toUpperCase()), false);
  assert.equal(isAppCredential(` ${APP}`), false);
  assert.equal(isAppCredential(APP), true);
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
    appCredential: APP,
    shopperAddress: ADDRESS,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, `Bearer ${GUEST}`);
      assert.equal(headers["X-Phoenix-App-Credential"], APP);
      assert.equal(headers["X-Phoenix-Shopper-Address"], ADDRESS);
      assert.equal("retry" in (init || {}), false);
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
    appCredential: APP,
    shopperAddress: ADDRESS,
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

  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((item) => String(item)).join(" "));
  };
  let crashed: Awaited<ReturnType<typeof cartUpstream>>;
  try {
    crashed = await cartUpstream({
      baseUrl: "http://127.0.0.1:9/api",
      path: "cart/",
      method: "GET",
      bearer: GUEST,
      appCredential: APP,
      shopperAddress: ADDRESS,
      fetchImpl: async () => {
        throw new Error(`network ${GUEST} ${APP} ${ADDRESS}`);
      },
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(crashed.ok, false);
  const captured = `${JSON.stringify(crashed)}\n${logged.join("\n")}`;
  assert.equal(captured.includes(GUEST), false);
  assert.equal(captured.includes(APP), false);
  assert.equal(captured.includes(ADDRESS), false);
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

test("CSRF retrieval asks for a csrf budget and does not issue a Django session", async () => {
  let calls = 0;
  const budgets: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const result = await callRoute(
    (event, routeConfig, _django, transport) => handleCsrf(event, routeConfig, transport),
    {
      headers: {
        "x-phoenix-csrf-request": "1",
        "sec-fetch-site": "same-origin",
      },
      django: async () => {
        calls += 1;
        throw new Error("CSRF must not call a guest cart route");
      },
      budgetFetch: async (url, init) => {
        budgets.push({
          url: String(url),
          body: String(init?.body || ""),
          headers: init?.headers as Record<string, string>,
        });
        return allowedBudgetResponse();
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].url.endsWith("/cart/budget/"), true);
  assert.equal(budgets[0].body, JSON.stringify({ operation: "csrf" }));
  assert.equal(typeof result.json.csrf_token, "string");
  assert.equal(result.text.includes(GUEST), false);
  assert.equal(result.retryAfter, null);
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

function rawEvent(pairs: Array<[string, string]>) {
  const raw: string[] = [];
  for (const [key, value] of pairs) raw.push(key, value);
  return { node: { req: { rawHeaders: raw, headers: {} } } } as unknown as ReturnType<typeof createEvent>;
}

test("stub transport: Nuxt constructs application headers and ignores browser copies", async () => {
  assert.notEqual(import.meta.dev, true);
  const browserCopies = rawEvent([
    ["do-connecting-ip", ADDRESS],
    ["x-forwarded-for", "198.51.100.20"],
    ["x-phoenix-shopper-address", "127.0.0.1"],
    ["x-phoenix-app-credential", "ee".repeat(32)],
  ]);
  assert.equal(selectShopperAddress(browserCopies, import.meta.dev === true, ""), null);
  assert.equal(selectShopperAddress(browserCopies, import.meta.dev === true, "digitalocean"), ADDRESS);
  assert.equal(selectShopperAddress(browserCopies, true, ""), DEVELOPMENT_SHOPPER_ADDRESS);
  assert.equal(selectShopperAddress(browserCopies, true, "digitalocean"), DEVELOPMENT_SHOPPER_ADDRESS);

  let calls = 0;
  const sent = await dispatchCartUpstream(browserCopies, {
    dev: false,
    trustedIngress: "digitalocean",
    appCredential: APP,
  }, {
    baseUrl: "https://cart.example/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["X-Phoenix-App-Credential"], APP);
      assert.equal(headers["X-Phoenix-Shopper-Address"], ADDRESS);
      assert.equal(headers.authorization, `Bearer ${GUEST}`);
      assert.equal(headers.cookie, undefined);
      assert.equal(init?.redirect, "manual");
      return new Response(JSON.stringify({ success: true, cart: cartBody }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(sent.ok, true);

  const development = await dispatchCartUpstream(browserCopies, {
    dev: true,
    trustedIngress: "",
    appCredential: APP,
  }, {
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    fetchImpl: async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["X-Phoenix-Shopper-Address"], DEVELOPMENT_SHOPPER_ADDRESS);
      return new Response(JSON.stringify({ success: true, cart: cartBody }), { status: 200 });
    },
  });
  assert.equal(development.ok, true);
});

test("stub transport: missing configuration and untrusted ingress send no upstream request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error(`called ${APP}`);
  };
  const missingCredential = await dispatchCartUpstream(rawEvent([["do-connecting-ip", ADDRESS]]), {
    dev: false,
    trustedIngress: "digitalocean",
    appCredential: "",
  }, {
    baseUrl: "https://cart.example/api",
    path: "cart/",
    method: "GET",
    fetchImpl,
  });
  const closed = await dispatchCartUpstream(rawEvent([
    ["do-connecting-ip", "127.0.0.1"],
    ["x-forwarded-for", ADDRESS],
    ["x-phoenix-shopper-address", DEVELOPMENT_SHOPPER_ADDRESS],
  ]), {
    dev: false,
    trustedIngress: "",
    appCredential: APP,
  }, {
    baseUrl: "https://cart.example/api",
    path: "cart/",
    method: "GET",
    fetchImpl,
  });
  const remoteHttp = await cartUpstream({
    baseUrl: "http://cart.example/api",
    path: "cart/",
    method: "GET",
    appCredential: APP,
    shopperAddress: ADDRESS,
    fetchImpl,
  });
  assert.equal(calls, 0);
  for (const result of [missingCredential, closed, remoteHttp]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CART_SERVICE_CONFIGURATION");
    const captured = JSON.stringify(result);
    assert.equal(captured.includes(APP), false);
    assert.equal(captured.includes(ADDRESS), false);
    assert.equal(captured.includes(DEVELOPMENT_SHOPPER_ADDRESS), false);
  }
  assert.equal(credentialUpstreamAllowed("https://cart.example/api"), true);
  assert.equal(credentialUpstreamAllowed("http://127.0.0.1:8000/api"), true);
  assert.equal(credentialUpstreamAllowed("http://localhost:8000/api"), true);
  assert.equal(credentialUpstreamAllowed("http://10.0.0.5/api"), false);
});

test("stub transport: digitalocean accepts one address and rejects ambiguous values", () => {
  const selected = (pairs: Array<[string, string]>) => selectShopperAddress(
    rawEvent(pairs),
    false,
    "digitalocean",
  );
  assert.equal(selected([["do-connecting-ip", ADDRESS]]), ADDRESS);
  assert.equal(selected([["do-connecting-ip", "2001:db8::1"]]), "2001:db8::1");
  const rejected: Array<Array<[string, string]>> = [
    [],
    [["x-forwarded-for", ADDRESS]],
    [["do-connecting-ip", ADDRESS], ["do-connecting-ip", "198.51.100.8"]],
    [["do-connecting-ip", `${ADDRESS}, 198.51.100.8`]],
    [["do-connecting-ip", `${ADDRESS} `]],
    [["do-connecting-ip", ` ${ADDRESS}`]],
    [["do-connecting-ip", `${ADDRESS}:443`]],
    [["do-connecting-ip", "203.0.113.0/24"]],
    [["do-connecting-ip", "[2001:db8::1]"]],
    [["do-connecting-ip", "fe80::1%eth0"]],
    [["do-connecting-ip", "not-an-ip"]],
  ];
  for (const pairs of rejected) {
    assert.equal(selected(pairs), null);
  }
  assert.equal(selectShopperAddress(rawEvent([["do-connecting-ip", DEVELOPMENT_SHOPPER_ADDRESS]]), false, ""), null);
  assert.equal(selectShopperAddress(rawEvent([["x-forwarded-for", DEVELOPMENT_SHOPPER_ADDRESS]]), false, "digitalocean"), null);
  assert.notEqual(selected([]), DEVELOPMENT_SHOPPER_ADDRESS);
});

test("stub transport: application failure preserves cookies and guest 401 stays recoverable", async () => {
  const application = classifyUpstream(503, {
    code: "CART_APPLICATION_REJECTED",
    error: `rejected ${APP} ${ADDRESS}`,
  }, { appCredential: APP, shopperAddress: ADDRESS });
  assert.equal(application.ok, false);
  if (!application.ok) {
    assert.equal(application.status, 503);
    assert.equal(application.code, "CART_SERVICE_UNAVAILABLE");
    assert.equal(JSON.stringify(application).includes(APP), false);
    assert.equal(JSON.stringify(application).includes(ADDRESS), false);
  }

  const guestDenied = classifyUpstream(401, {
    code: "CART_ACCESS_UNAVAILABLE",
    error: "Cart access is not available.",
  });
  assert.equal(guestDenied.ok, false);
  if (!guestDenied.ok) {
    assert.equal(guestDenied.status, 401);
    assert.equal(guestDenied.code, "CART_ACCESS_UNAVAILABLE");
  }

  const limited = classifyUpstream(429, {
    success: false,
    code: "CART_RATE_LIMITED",
    error: `budget ${APP}`,
  }, { appCredential: APP });
  assert.equal(limited.ok, false);
  if (!limited.ok) {
    assert.equal(limited.status, 429);
    assert.equal(limited.code, "CART_RATE_LIMITED");
    assert.equal(JSON.stringify(limited).includes(APP), false);
  }
  const otherLimit = classifyUpstream(429, { code: "TOO_MANY" });
  assert.equal(otherLimit.ok, false);
  if (!otherLimit.ok) assert.equal(otherLimit.code, "CART_SERVICE_UNAVAILABLE");

  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const headers = mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` });
  const read = await callRoute(handleGet, {
    headers: { cookie: `phoenix_guest_dev=${GUEST}` },
    django: async () => application,
  });
  assert.equal(read.status, 503);
  assert.equal(read.json.code, "CART_SERVICE_UNAVAILABLE");
  assert.equal(read.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);
  assert.equal(read.text.includes(APP), false);

  let writes = 0;
  const added = await callRoute(handleAdd, {
    method: "POST",
    headers,
    body: { product_id: 3, quantity: 1, options: [8] },
    django: async () => {
      writes += 1;
      return application;
    },
  });
  assert.equal(writes, 1);
  assert.equal(added.status, 503);
  assert.equal(added.json.code, "CART_SERVICE_UNAVAILABLE");
  assert.equal(added.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);

  const reset = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => application,
  });
  assert.equal(reset.status, 503);
  assert.equal(reset.json.code, "CART_TEMPORARILY_UNAVAILABLE");
  assert.notEqual(reset.json.code, "CART_ACCESS_UNAVAILABLE");
  assert.equal(reset.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);

  const recovered = await callRoute(handleGet, {
    headers: { cookie: `phoenix_guest_dev=${GUEST}` },
    django: async () => guestDenied,
  });
  assert.equal(recovered.status, 401);
  assert.equal(recovered.json.code, "CART_ACCESS_UNAVAILABLE");
  assert.equal(recovered.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), false);
});

function csrfHandler(
  event: ReturnType<typeof createEvent>,
  routeConfig: CartConfig,
  _django: DjangoCall,
  transport: { baseUrl: string; fetchImpl?: typeof fetch },
) {
  return handleCsrf(event, routeConfig, transport);
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("stub budget: rejected CSRF metadata returns before any budget request", async () => {
  let budgets = 0;
  const result = await callRoute(csrfHandler, {
    headers: { "x-phoenix-csrf-request": "1", "sec-fetch-site": "cross-site" },
    budgetFetch: async () => {
      budgets += 1;
      return allowedBudgetResponse();
    },
  });
  assert.equal(budgets, 0);
  assert.equal(result.status, 403);
  assert.equal(result.json.csrf_token, undefined);
  assert.equal(result.cookies.length, 0);
});

test("stub budget: rejected reset checks return before any budget request", async () => {
  let budgets = 0;
  const denied = await callRoute(handleReset, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { confirm: true },
    budgetFetch: async () => {
      budgets += 1;
      return allowedBudgetResponse();
    },
  });
  assert.equal(budgets, 0);
  assert.equal(denied.status, 403);

  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const unconfirmed = await callRoute(handleReset, {
    method: "POST",
    headers: mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` }),
    body: { confirm: false },
    budgetFetch: async () => {
      budgets += 1;
      return allowedBudgetResponse();
    },
  });
  assert.equal(budgets, 0);
  assert.equal(unconfirmed.status, 400);
});

test("stub budget: CSRF allowance uses application headers and never a guest bearer", async () => {
  const seen: Array<Record<string, string>> = [];
  const event = rawEvent([
    ["do-connecting-ip", ADDRESS],
    ["cookie", `phoenix_guest_dev=${GUEST}`],
    ["authorization", `Bearer ${GUEST}`],
    ["x-phoenix-csrf", "browser-token"],
  ]);
  const decision = await sendCartBudget({
    event,
    config: { ...config, dev: false, trustedIngress: "digitalocean" },
    operation: "csrf",
    baseUrl: "http://127.0.0.1:9/api",
    fetchImpl: async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      seen.push(headers);
      assert.equal(String(url), "http://127.0.0.1:9/api/cart/budget/");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ operation: "csrf" }));
      assert.equal(init?.redirect, "manual");
      assert.equal("retry" in (init || {}), false);
      return allowedBudgetResponse();
    },
  });
  assert.equal(decision.ok, true);
  assert.deepEqual(Object.keys(seen[0]).sort(), [
    "X-Phoenix-App-Credential",
    "X-Phoenix-Shopper-Address",
    "accept",
    "content-type",
  ]);
  assert.equal(seen[0]["X-Phoenix-App-Credential"], APP);
  assert.equal(seen[0]["X-Phoenix-Shopper-Address"], ADDRESS);
  assert.equal(seen[0].authorization, undefined);

  for (const cookie of [
    `phoenix_guest_dev=${GUEST}`,
    "phoenix_guest_dev=expired-token",
    "phoenix_guest_dev=%%%",
  ]) {
    const upstream: Array<Record<string, string> | undefined> = [];
    const result = await callRoute(csrfHandler, {
      headers: {
        "x-phoenix-csrf-request": "1",
        "sec-fetch-site": "same-origin",
        cookie,
      },
      budgetFetch: async (_url, init) => {
        upstream.push(init?.headers as Record<string, string>);
        return allowedBudgetResponse();
      },
    });
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0]?.authorization, undefined);
    assert.equal(upstream[0]?.cookie, undefined);
    assert.equal(result.text.includes("expired-token"), false);
  }
});

test("stub budget: CSRF denial or failure issues no token and no cookie", async () => {
  let budgets = 0;
  const denied = await callRoute(csrfHandler, {
    headers: { "x-phoenix-csrf-request": "1", "sec-fetch-site": "same-origin" },
    budgetFetch: async () => {
      budgets += 1;
      return jsonResponse(429, {
        success: false,
        code: "CART_RATE_LIMITED",
        error: "Cart access is temporarily limited.",
      }, { "retry-after": "12" });
    },
  });
  assert.equal(budgets, 1);
  assert.equal(denied.status, 429);
  assert.equal(denied.json.code, "CART_RATE_LIMITED");
  assert.equal(denied.json.csrf_token, undefined);
  assert.equal(denied.retryAfter, "12");
  assert.equal(denied.cookies.length, 0);

  const failed = await callRoute(csrfHandler, {
    headers: { "x-phoenix-csrf-request": "1", "sec-fetch-site": "same-origin" },
    budgetFetch: async () => jsonResponse(401, {
      success: false,
      code: "CART_ACCESS_UNAVAILABLE",
      error: `bearer ${GUEST}`,
    }, { "retry-after": "12" }),
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.code, "CART_SERVICE_UNAVAILABLE");
  assert.notEqual(failed.json.code, "CART_ACCESS_UNAVAILABLE");
  assert.equal(failed.json.csrf_token, undefined);
  assert.equal(failed.retryAfter, null);
  assert.equal(failed.cookies.length, 0);
  assert.equal(failed.text.includes(GUEST), false);
});

test("stub budget: reset denial skips the guest probe and leaves cookies unchanged", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  let probes = 0;
  let budgets = 0;
  const denied = await callRoute(handleReset, {
    method: "POST",
    headers: mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` }),
    body: { confirm: true },
    django: async () => {
      probes += 1;
      throw new Error("guest probe was not allowed");
    },
    budgetFetch: async () => {
      budgets += 1;
      return jsonResponse(503, { success: false, code: "CART_TEMPORARILY_UNAVAILABLE" });
    },
  });
  assert.equal(budgets, 1);
  assert.equal(probes, 0);
  assert.equal(denied.status, 503);
  assert.equal(denied.json.code, "CART_TEMPORARILY_UNAVAILABLE");
  assert.equal(denied.cookies.length, 0);
});

test("stub budget: allowed reset probes the guest cart only after allowance", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const order: string[] = [];
  const result = await callRoute(handleReset, {
    method: "POST",
    headers: mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` }),
    body: { confirm: true },
    budgetFetch: async (_url, init) => {
      order.push("budget");
      assert.equal(init?.body, JSON.stringify({ operation: "reset" }));
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, undefined);
      return allowedBudgetResponse();
    },
    django: async (input) => {
      order.push(`probe:${input.path}`);
      assert.equal(input.bearer, GUEST);
      return {
        ok: false,
        status: 401,
        code: "CART_ACCESS_UNAVAILABLE",
        error: "Cart access is not available.",
        category: "upstream",
      };
    },
  });
  assert.deepEqual(order, ["budget", "probe:cart/"]);
  assert.equal(result.json.code, "CART_SESSION_RESET");
  assert.equal(result.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), true);

  const limited = await callRoute(handleReset, {
    method: "POST",
    headers: mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` }),
    body: { confirm: true },
    django: async () => ({
      ok: false,
      status: 429,
      code: "CART_RATE_LIMITED",
      error: "Cart access is temporarily limited.",
      category: "upstream",
      retryAfter: 20,
    }),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, "CART_RATE_LIMITED");
  assert.equal(limited.retryAfter, "20");
  assert.equal(limited.cookies.length, 0);
});

test("stub budget: a budget-endpoint 401 never clears the guest cookie", async () => {
  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  let probes = 0;
  const result = await callRoute(handleReset, {
    method: "POST",
    headers: mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` }),
    body: { confirm: true },
    django: async () => {
      probes += 1;
      return {
        ok: false,
        status: 401,
        code: "CART_ACCESS_UNAVAILABLE",
        error: "Cart access is not available.",
        category: "upstream",
      };
    },
    budgetFetch: async () => jsonResponse(401, {
      success: false,
      code: "CART_ACCESS_UNAVAILABLE",
    }),
  });
  assert.equal(probes, 0);
  assert.equal(result.status, 503);
  assert.equal(result.json.code, "CART_SERVICE_UNAVAILABLE");
  assert.equal(result.cookies.length, 0);
});

test("stub budget: missing and malformed cookies still require reset allowance", async () => {
  const bootstrap = issueCsrfToken({ secret: SECRET, context: "bootstrap", binding: BOOTSTRAP });
  const headers = mutationHeaders(bootstrap, { cookie: `phoenix_cart_bootstrap_dev=${BOOTSTRAP}` });
  let probes = 0;
  const denied = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => {
      probes += 1;
      throw new Error("missing cookie must not probe Django");
    },
    budgetFetch: async () => jsonResponse(429, {
      success: false,
      code: "CART_RATE_LIMITED",
      error: "Cart access is temporarily limited.",
    }),
  });
  assert.equal(probes, 0);
  assert.equal(denied.status, 429);
  assert.equal(denied.cookies.length, 0);

  const allowed = await callRoute(handleReset, {
    method: "POST",
    headers,
    body: { confirm: true },
    django: async () => {
      probes += 1;
      throw new Error("missing cookie must not probe Django");
    },
  });
  assert.equal(probes, 0);
  assert.equal(allowed.json.code, "CART_SESSION_RESET");
  assert.equal(allowed.cookies.some((cookie) => cookie.startsWith("phoenix_cart_bootstrap_dev=")), true);

  const malformedHeaders = mutationHeaders(bootstrap, {
    cookie: `phoenix_guest_dev=short; phoenix_cart_bootstrap_dev=${BOOTSTRAP}`,
  });
  const blocked = await callRoute(handleReset, {
    method: "POST",
    headers: malformedHeaders,
    body: { confirm: true },
    django: async () => {
      probes += 1;
      throw new Error("malformed cookie must not probe Django");
    },
    budgetFetch: async () => jsonResponse(503, { code: "CART_APPLICATION_REJECTED", error: APP }),
  });
  assert.equal(probes, 0);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.json.code, "CART_SERVICE_UNAVAILABLE");
  assert.equal(blocked.cookies.length, 0);
  assert.equal(blocked.text.includes(APP), false);

  const cleared = await callRoute(handleReset, {
    method: "POST",
    headers: malformedHeaders,
    body: { confirm: true },
    django: async () => {
      probes += 1;
      throw new Error("malformed cookie must not probe Django");
    },
  });
  assert.equal(probes, 0);
  assert.equal(cleared.json.code, "CART_SESSION_RESET");
  assert.equal(cleared.cookies.some((cookie) => cookie.startsWith("phoenix_guest_dev=")), true);
});

test("stub budget: only the exact allowance continues, and one failure is not repeated", async () => {
  assert.equal(isBudgetOperation("csrf"), true);
  assert.equal(isBudgetOperation("reset"), true);
  assert.equal(isBudgetOperation("start"), false);
  const event = rawEvent([]);
  let calls = 0;
  const rejected = await sendCartBudget({
    event,
    config,
    operation: "start" as "csrf",
    baseUrl: "http://127.0.0.1:9/api",
    fetchImpl: async () => {
      calls += 1;
      return allowedBudgetResponse();
    },
  });
  assert.equal(calls, 0);
  assert.equal(rejected.ok, false);

  const responses = [
    new Response(null, { status: 302, headers: { location: "https://evil.example/budget" } }),
    null,
    new Response("missing", { status: 404, headers: { "content-type": "text/plain" } }),
    new Response("<html>no</html>", { status: 200, headers: { "content-type": "text/html" } }),
    new Response("", { status: 200 }),
    jsonResponse(201, { success: true, code: "CART_BUDGET_ALLOWED" }),
    jsonResponse(200, { success: "true", code: "CART_BUDGET_ALLOWED" }),
    jsonResponse(200, { success: true, code: "CART_BUDGET_ALLOWED", cart: { id: "nope" } }),
    jsonResponse(200, { success: true }),
    jsonResponse(401, { success: false, code: "CART_ACCESS_UNAVAILABLE" }),
    jsonResponse(503, { success: false, code: "CART_APPLICATION_REJECTED", error: APP }),
  ];
  for (const response of responses) {
    let attempts = 0;
    const decision = await sendCartBudget({
      event,
      config,
      operation: "reset",
      baseUrl: "http://127.0.0.1:9/api",
      fetchImpl: async () => {
        attempts += 1;
        if (!response) throw new Error("stub network failure");
        return response;
      },
    });
    assert.equal(attempts, 1);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.notEqual(decision.code, "CART_ACCESS_UNAVAILABLE");
      assert.equal(JSON.stringify(decision).includes(APP), false);
    }
  }

  const temporary = await sendCartBudget({
    event,
    config,
    operation: "csrf",
    baseUrl: "http://127.0.0.1:9/api",
    fetchImpl: async () => jsonResponse(503, { code: "CART_TEMPORARILY_UNAVAILABLE" }),
  });
  assert.equal(temporary.ok, false);
  if (!temporary.ok) assert.equal(temporary.code, "CART_TEMPORARILY_UNAVAILABLE");

  const allowed = classifyBudgetResponse(200, { success: true, code: "CART_BUDGET_ALLOWED" }, true);
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.deepEqual(allowed.body, { success: true, code: "CART_BUDGET_ALLOWED" });
});

test("stub budget: Retry-After is forwarded only for a genuine rate limit", async () => {
  for (const value of ["", "0", "-1", "+30", "1.5", "1e2", "Wed, 21 Oct 2015 07:28:00 GMT", "30\r\nSet-Cookie: a=b", "30, 40", "86401", "00030", " 30"]) {
    assert.equal(parseRetryAfterHeader(value), null, value);
  }
  assert.equal(parseRetryAfterHeader("1"), 1);
  assert.equal(parseRetryAfterHeader("30"), 30);
  assert.equal(parseRetryAfterHeader("86400"), 86400);

  const forwarded = await cartUpstream({
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    appCredential: APP,
    shopperAddress: ADDRESS,
    fetchImpl: async () => jsonResponse(429, {
      success: false,
      code: "CART_RATE_LIMITED",
      error: `wait ${APP}`,
    }, { "retry-after": "45", "set-cookie": "upstream=1" }),
  });
  assert.equal(forwarded.ok, false);
  if (!forwarded.ok) {
    assert.equal(forwarded.retryAfter, 45);
    assert.equal(forwarded.error, "Cart access is temporarily limited.");
    assert.equal(JSON.stringify(forwarded).includes("set-cookie"), false);
  }

  const omitted = await cartUpstream({
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    appCredential: APP,
    shopperAddress: ADDRESS,
    fetchImpl: async () => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("retry-after", "30");
      headers.append("retry-after", "40");
      return new Response(JSON.stringify({
        success: false,
        code: "CART_RATE_LIMITED",
      }), { status: 429, headers });
    },
  });
  assert.equal(omitted.ok, false);
  if (!omitted.ok) assert.equal(omitted.retryAfter, undefined);

  const success = await cartUpstream({
    baseUrl: "http://127.0.0.1:9/api",
    path: "cart/",
    method: "GET",
    bearer: GUEST,
    appCredential: APP,
    shopperAddress: ADDRESS,
    fetchImpl: async () => jsonResponse(200, { success: true, cart: cartBody }, { "retry-after": "30" }),
  });
  assert.equal(success.ok, true);
  assert.equal("retryAfter" in success, false);

  const csrf = issueCsrfToken({ secret: SECRET, context: "guest", binding: GUEST });
  const headers = mutationHeaders(csrf, { cookie: `phoenix_guest_dev=${GUEST}` });
  const read = await callRoute(handleGet, {
    headers: { cookie: `phoenix_guest_dev=${GUEST}` },
    django: async () => ({
      ok: false,
      status: 429,
      code: "CART_RATE_LIMITED",
      error: "Cart access is temporarily limited.",
      category: "upstream",
      retryAfter: 45,
    }),
  });
  assert.equal(read.status, 429);
  assert.equal(read.json.code, "CART_RATE_LIMITED");
  assert.equal(read.retryAfter, "45");
  assert.equal(read.cookies.length, 0);

  const validation = await callRoute(handleAdd, {
    method: "POST",
    headers,
    body: { product_id: 3, quantity: 1, options: [8] },
    django: async () => ({
      ok: false,
      status: 400,
      code: "INVALID_OPTION",
      error: "Choose a valid option for this product.",
      category: "upstream",
      retryAfter: 45,
    }),
  });
  assert.equal(validation.status, 400);
  assert.equal(validation.retryAfter, null);
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
