import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createEvent } from "h3";

import { isPlaceholderSecret } from "../server/utils/cartConfig.ts";
import {
  CART_CACHE_CONTROL,
  applyCartCachePolicy,
  isCartCachePath,
  mergeVaryCookie,
  withCartCacheHeaders,
} from "../server/utils/cartCachePolicy.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("../.output/server/index.mjs", import.meta.url));
const TEST_ORIGIN = "https://cart-cache-test.invalid";
const VALID_SECRET = "ab".repeat(32);
const APP_CREDENTIAL = "cd".repeat(32);
const INVALID_SECRET = `not-valid-${process.pid}`;
const BUILT_GUEST = "C".repeat(43);
const BUILT_ADDRESS = "203.0.113.10";

function redact(text: string): string {
  return text
    .replaceAll(VALID_SECRET, "[redacted]")
    .replaceAll(APP_CREDENTIAL, "[redacted]")
    .replaceAll(INVALID_SECRET, "[redacted]")
    .replace(/[0-9a-f]{64}/gi, "[redacted]");
}

test("cart cache paths use the pathname and ignore the query", () => {
  assert.equal(isCartCachePath("/api/cart"), true);
  assert.equal(isCartCachePath("/api/cart/"), true);
  assert.equal(isCartCachePath("/api/cart/clear"), true);
  assert.equal(isCartCachePath("/api/cart/a-nonexistent-test-path"), true);
  assert.equal(isCartCachePath("/api/cartoon"), false);
  assert.equal(isCartCachePath("/api/cartography"), false);
  assert.equal(isCartCachePath("/api/products"), false);
  assert.equal(isCartCachePath(new URL("http://127.0.0.1/api/cart?probe=1").pathname), true);
  assert.equal(isCartCachePath(new URL("http://127.0.0.1/api/cartoon?cart=1").pathname), false);
});

test("Vary merge keeps other tokens and does not change Vary star", () => {
  assert.equal(mergeVaryCookie(undefined), "Cookie");
  assert.equal(mergeVaryCookie("Accept-Encoding"), "Accept-Encoding, Cookie");
  assert.equal(mergeVaryCookie("Cookie"), "Cookie");
  assert.equal(mergeVaryCookie("accept-encoding, cookie"), "accept-encoding, cookie");
  assert.equal(mergeVaryCookie("*"), null);
  assert.equal(mergeVaryCookie("Accept-Encoding, *"), null);
  const headers = withCartCacheHeaders(
    { "cache-control": "no-cache", vary: "Accept-Encoding", "x-frame-options": "DENY" },
    undefined,
  );
  assert.equal(headers["cache-control"], CART_CACHE_CONTROL);
  assert.equal(headers.vary, "Accept-Encoding, Cookie");
  assert.equal(headers["x-frame-options"], "DENY");
  const starred = withCartCacheHeaders({ vary: "*" }, undefined);
  assert.equal(starred.vary, "*");
});

test("h3 response: an existing Vary token survives the cart policy", async () => {
  const server = createServer((req, res) => {
    const event = createEvent(req, res);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("X-Frame-Options", "DENY");
    applyCartCachePolicy(event);
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  try {
    const cart = await fetch(`http://127.0.0.1:${address.port}/api/cart?probe=1`);
    assert.equal(cart.status, 200);
    assert.equal(cart.headers.get("cache-control"), CART_CACHE_CONTROL);
    assert.equal(cart.headers.get("pragma"), "no-cache");
    assert.equal(cart.headers.get("vary"), "Accept-Encoding, Cookie");
    assert.equal(cart.headers.get("x-frame-options"), "DENY");
    const other = await fetch(`http://127.0.0.1:${address.port}/api/cartoon`);
    assert.equal(other.headers.get("cache-control"), null);
    assert.equal(other.headers.get("vary"), "Accept-Encoding");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No test port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startBuiltServer(
  secret: string,
  extra: Record<string, string> = {},
): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await freePort();
  let output = "";
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(port),
      NUXT_CART_ORIGIN: TEST_ORIGIN,
      NUXT_CART_CSRF_SECRET: secret,
      NUXT_CART_APP_CREDENTIAL: APP_CREDENTIAL,
      NUXT_CART_TRUSTED_INGRESS: "digitalocean",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Built server did not listen. ${redact(output).slice(-500)}`));
    }, 20000);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`Built server exited ${code}. ${redact(output).slice(-500)}`));
    };
    child.once("exit", onExit);
    const poll = () => {
      if (!output.includes("Listening on")) return;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve();
    };
    child.stdout?.on("data", poll);
    child.stderr?.on("data", poll);
    poll();
  });
  try {
    await ready;
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => stopProcess(child),
  };
}

async function request(baseUrl: string, method: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, { method, redirect: "manual" });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}

function assertCartPolicy(headers: Headers) {
  assert.equal(headers.get("cache-control"), CART_CACHE_CONTROL);
  assert.equal(headers.get("pragma"), "no-cache");
  assert.match(headers.get("vary") || "", /Cookie/);
}

test("built nitro: cart responses keep no-store without widening the policy", { timeout: 30000 }, async () => {
  assert.equal(isPlaceholderSecret(VALID_SECRET), false);
  const server = await startBuiltServer(VALID_SECRET);
  try {
    const paths = [
      ["GET", "/api/cart", 401],
      ["POST", "/api/cart", 404],
      ["PUT", "/api/cart/clear", 404],
      ["GET", "/api/cart/a-nonexistent-test-path", 404],
    ] as const;
    for (const [method, path, status] of paths) {
      const result = await request(server.baseUrl, method, path);
      assert.equal(result.status, status, `${method} ${path}`);
      assertCartPolicy(result.headers);
      assert.equal(result.text.includes(VALID_SECRET), false);
    }
    const probed = await request(server.baseUrl, "GET", "/api/cart?probe=1");
    assert.equal(probed.status, 401);
    assert.equal(JSON.parse(probed.text).code, "CART_SESSION_REQUIRED");
    assertCartPolicy(probed.headers);

    const csrf = await request(server.baseUrl, "GET", "/api/cart/csrf");
    assert.equal(csrf.status, 403);
    assert.equal(JSON.parse(csrf.text).code, "CART_REQUEST_REJECTED");
    assert.equal(JSON.parse(csrf.text).csrf_token, undefined);
    assertCartPolicy(csrf.headers);

    const health = await request(server.baseUrl, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.notEqual(health.headers.get("cache-control"), CART_CACHE_CONTROL);
    assert.equal((health.headers.get("cache-control") || "").includes("no-store"), false);

    const cartoon = await request(server.baseUrl, "GET", "/api/cartoon");
    assert.equal(cartoon.status, 404);
    assert.equal(cartoon.headers.get("cache-control"), "no-cache");
  } finally {
    await server.stop();
  }
});

test("built nitro: invalid cart configuration stays private and does not echo the secret", { timeout: 30000 }, async () => {
  assert.equal(isPlaceholderSecret(INVALID_SECRET), true);
  const server = await startBuiltServer(INVALID_SECRET);
  try {
    const result = await request(server.baseUrl, "GET", "/api/cart");
    assert.equal(result.status, 503);
    const body = JSON.parse(result.text);
    assert.equal(body.success, false);
    assert.equal(body.code, "CART_SERVICE_CONFIGURATION");
    assert.equal(result.text.includes(INVALID_SECRET), false, "configuration response included the test secret");
    assert.equal(/[0-9a-f]{64}/i.test(result.text), false);
    assertCartPolicy(result.headers);

    const missing = await request(server.baseUrl, "GET", "/api/cart/a-nonexistent-test-path");
    assert.equal(missing.status, 404);
    assertCartPolicy(missing.headers);
    assert.equal(missing.text.includes(INVALID_SECRET), false);
  } finally {
    await server.stop();
  }
});

test("built nitro: production selects one connecting address and fails closed without trusted ingress", { timeout: 30000 }, async () => {
  const seen: Array<Record<string, string | undefined>> = [];
  const stub = createServer((req, res) => {
    seen.push({
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      app: req.headers["x-phoenix-app-credential"],
      address: req.headers["x-phoenix-shopper-address"],
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      cart: {
        id: "11111111-1111-1111-1111-111111111111",
        items: [],
        item_count: 0,
        total: "0.00",
      },
    }));
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubAddress = stub.address();
  if (!stubAddress || typeof stubAddress === "string") throw new Error("No stub port");
  const djangoBase = `http://127.0.0.1:${stubAddress.port}/api`;
  const browserHeaders = {
    cookie: `__Host-phoenix_guest=${BUILT_GUEST}`,
    "do-connecting-ip": BUILT_ADDRESS,
    "x-forwarded-for": "198.51.100.20",
    "x-phoenix-shopper-address": "127.0.0.1",
    "x-phoenix-app-credential": "ee".repeat(32),
  };
  const trusted = await startBuiltServer(VALID_SECRET, { NUXT_DJANGO_API_BASE: djangoBase });
  try {
    const response = await fetch(`${trusted.baseUrl}/api/cart`, { headers: browserHeaders, redirect: "manual" });
    const text = await response.text();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].app, APP_CREDENTIAL);
    assert.equal(seen[0].address, BUILT_ADDRESS);
    assert.equal(seen[0].authorization, `Bearer ${BUILT_GUEST}`);
    assert.equal(seen[0].cookie, undefined);
    assert.equal(text.includes(APP_CREDENTIAL), false);
    assert.equal(text.includes("127.0.0.1"), false);
    assert.equal(text.includes(BUILT_ADDRESS), false);
    assert.equal(response.status, 200);
    assertCartPolicy(response.headers);

    seen.length = 0;
    const malformed = await fetch(`${trusted.baseUrl}/api/cart`, {
      headers: { ...browserHeaders, "do-connecting-ip": `${BUILT_ADDRESS}, 198.51.100.8` },
      redirect: "manual",
    });
    const malformedText = await malformed.text();
    assert.equal(seen.length, 0);
    assert.equal(malformed.status, 503);
    assert.equal(JSON.parse(malformedText).code, "CART_SERVICE_CONFIGURATION");
    assert.equal(malformedText.includes(APP_CREDENTIAL), false);
  } finally {
    await trusted.stop();
  }

  seen.length = 0;
  const closed = await startBuiltServer(VALID_SECRET, {
    NUXT_DJANGO_API_BASE: djangoBase,
    NUXT_CART_TRUSTED_INGRESS: "",
  });
  try {
    const response = await fetch(`${closed.baseUrl}/api/cart`, { headers: browserHeaders, redirect: "manual" });
    const text = await response.text();
    assert.equal(seen.length, 0);
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(text).code, "CART_SERVICE_CONFIGURATION");
    assert.equal(text.includes(APP_CREDENTIAL), false);
    assert.equal(text.includes("127.0.0.1"), false);
    assert.equal(text.includes(BUILT_ADDRESS), false);
    assertCartPolicy(response.headers);
  } finally {
    await closed.stop();
    await new Promise<void>((resolve) => stub.close(resolve));
  }
});

test("built nitro: a stub upstream 429 keeps Retry-After on the Nuxt response", { timeout: 30000 }, async () => {
  const seen: string[] = [];
  const stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url}`);
      const delay = req.url === "/api/cart/" ? "45" : "30";
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": delay,
        "set-cookie": "upstream=1",
      });
      res.end(JSON.stringify({
        success: false,
        code: "CART_RATE_LIMITED",
        error: `wait ${APP_CREDENTIAL}`,
      }));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubAddress = stub.address();
  if (!stubAddress || typeof stubAddress === "string") throw new Error("No stub port");
  const server = await startBuiltServer(VALID_SECRET, {
    NUXT_DJANGO_API_BASE: `http://127.0.0.1:${stubAddress.port}/api`,
  });
  try {
    const cart = await fetch(`${server.baseUrl}/api/cart`, {
      headers: {
        cookie: `__Host-phoenix_guest=${BUILT_GUEST}`,
        "do-connecting-ip": BUILT_ADDRESS,
      },
      redirect: "manual",
    });
    const cartText = await cart.text();
    assert.equal(cart.status, 429);
    assert.equal(JSON.parse(cartText).code, "CART_RATE_LIMITED");
    assert.equal(cart.headers.get("retry-after"), "45");
    assert.equal(cart.headers.get("set-cookie"), null);
    assert.equal(cartText.includes(APP_CREDENTIAL), false);
    assertCartPolicy(cart.headers);

    const csrf = await new Promise<{ status: number; retryAfter: string | string[] | undefined; setCookie: string | string[] | undefined; text: string }>((resolve, reject) => {
      const outgoing = httpRequest({
        host: "127.0.0.1",
        port: new URL(server.baseUrl).port,
        path: "/api/cart/csrf",
        method: "GET",
        headers: {
          host: "cart-cache-test.invalid",
          origin: TEST_ORIGIN,
          "do-connecting-ip": BUILT_ADDRESS,
          "x-phoenix-csrf-request": "1",
          "sec-fetch-site": "same-origin",
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode || 0,
          retryAfter: response.headers["retry-after"],
          setCookie: response.headers["set-cookie"],
          text: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
    assert.equal(csrf.status, 429);
    assert.equal(JSON.parse(csrf.text).csrf_token, undefined);
    assert.equal(JSON.parse(csrf.text).code, "CART_RATE_LIMITED");
    assert.equal(csrf.retryAfter, "30");
    assert.equal(csrf.setCookie, undefined);
    assert.equal(csrf.text.includes(APP_CREDENTIAL), false);
    assert.deepEqual(seen, ["GET /api/cart/", "POST /api/cart/budget/"]);
  } finally {
    await server.stop();
    await new Promise<void>((resolve) => stub.close(resolve));
  }
});
