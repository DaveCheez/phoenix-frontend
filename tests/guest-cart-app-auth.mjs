// Local application-authentication check. Uses the Edge runner and loopback only.
// Does not print cookies, CSRF tokens, application credentials, or shopper addresses.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CART,
  ORIGIN,
  PRODUCT,
  UNCERTAIN,
  cookieSame,
  guestCookie,
  isCreate,
  launch,
  redact,
  sleep,
  waitFor,
} from "./guest-cart-browser.mjs";

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ROOT = resolve(FRONTEND_ROOT, "../../phoenix-vanz-backend-digitalocean-ready/backend");
const PYTHON = resolve(FRONTEND_ROOT, "../../phoenix-vanz-backend-digitalocean-ready/venv/Scripts/python.exe");
const SQLITE = join(BACKEND_ROOT, "db.sqlite3");
const RECOVERY = "We cannot reopen your previous basket. Start a new empty basket to continue.";
const results = [];

function record(id, status, detail = "") {
  results.push({ id, status, detail });
  console.log(`${id} ${status}${detail ? ` — ${redact(detail)}` : ""}`);
}

function envValue(path, key) {
  const values = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0 || trimmed.slice(0, eq).trim() !== key) continue;
    values.push(trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

function credential() {
  const front = envValue(join(FRONTEND_ROOT, ".env"), "NUXT_CART_APP_CREDENTIAL");
  const back = envValue(join(BACKEND_ROOT, ".env"), "CART_APP_CREDENTIAL");
  if (front.length !== 1 || back.length !== 1 || front[0] !== back[0] || !/^[0-9a-f]{64}$/.test(front[0])) {
    throw new Error("local application credentials are not one matching configured value");
  }
  return front[0];
}

function differentCredential(current) {
  let next = "";
  do {
    next = randomBytes(32).toString("hex");
  } while (next === current || !/^[0-9a-f]{64}$/.test(next));
  return next;
}

async function catalogue() {
  const response = await fetch("http://127.0.0.1:8000/api/products/guest-cart-integration-test/");
  if (!response.ok) throw new Error(`catalogue status ${response.status}`);
  const body = await response.json();
  const groups = Array.isArray(body.option_groups) ? body.option_groups : [];
  const options = groups.flatMap((group) => (group.options || []).map((option) => ({
    group: group.name,
    id: option.id,
    name: option.name,
    adjustment: option.price_adjustment,
    default: option.is_default === true,
  })));
  return { id: body.id, price: body.price, options };
}

async function snapshot(cartId = "") {
  const directory = await mkdtemp(join(tmpdir(), "phoenix-cart-snapshot-"));
  const script = join(directory, "snapshot.py");
  await writeFile(script, `
import json, sqlite3, sys
cart_id = sys.stdin.read().strip().replace("-", "")
connection = sqlite3.connect(${JSON.stringify(`file:${SQLITE.replaceAll("\\", "/")}?mode=ro`)}, uri=True)
connection.row_factory = sqlite3.Row
counts = {
    "sessions": connection.execute("select count(*) from cart_guestsession").fetchone()[0],
    "carts": connection.execute("select count(*) from cart_cart").fetchone()[0],
    "items": connection.execute("select count(*) from cart_cartitem").fetchone()[0],
}
cart = None
if cart_id:
    row = connection.execute("select id, updated_at, guest_session_id from cart_cart where replace(id, '-', '') = ?", (cart_id,)).fetchone()
    if row:
        items = []
        for item in connection.execute("select id, quantity, updated_at from cart_cartitem where cart_id = ? order by id", (cart_id,)):
            options = [option[0] for option in connection.execute("select option_id from cart_cartitemoption where cart_item_id = ? order by option_id", (item["id"],))]
            items.append({"id": item["id"], "quantity": item["quantity"], "updated_at": item["updated_at"], "options": options})
        cart = {"updated_at": row["updated_at"], "guest_session_id": row["guest_session_id"], "items": items}
print(json.dumps({"counts": counts, "cart": cart}))
`);
  const child = spawn(PYTHON, [script], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let error = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    error += chunk.toString("utf8");
  });
  child.stdin.end(cartId);
  const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
  await rm(directory, { recursive: true, force: true });
  if (code !== 0) throw new Error(`snapshot failed ${redact(error).slice(0, 200)}`);
  return JSON.parse(output);
}

async function djangoCall(path, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`http://127.0.0.1:8000/api/cart/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let code = "";
  try {
    const parsed = JSON.parse(text);
    code = typeof parsed.code === "string" ? parsed.code : "";
  } catch {
    code = "";
  }
  return { status: response.status, code, redirected: response.status >= 300 && response.status < 400 };
}

function safeEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function lineFacts(page, method, path, status, from) {
  const facts = await page.responseFacts(method, path, status, from);
  if (!facts?.requestId && facts?.unavailable) return facts;
  const entry = [...page.traffic].reverse().find((item) =>
    item.method === method && item.path === path && item.status === status && item.at >= from && item.requestId);
  if (!entry) return facts;
  const payload = await page.send("Network.getResponseBody", { requestId: entry.requestId }).catch(() => null);
  if (!payload) return facts;
  const raw = payload.base64Encoded ? Buffer.from(payload.body, "base64").toString("utf8") : payload.body;
  const parsed = JSON.parse(raw);
  const item = parsed.cart?.items?.[0] || {};
  return {
    ...facts,
    quantity: item.quantity ?? null,
    configured: item.configured_unit_price || "",
    line: item.line_total || "",
    optionIds: Array.isArray(item.selected_options)
      ? item.selected_options.map((option) => String(option.option_id))
      : facts?.optionIds || [],
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) throw new Error("no free port");
  return port;
}

async function startMismatch(badCredential) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  let output = "";
  const child = spawn(process.execPath, [
    join(FRONTEND_ROOT, "node_modules/nuxt/bin/nuxt.mjs"),
    "dev",
    "--port",
    String(port),
    "--host",
    "localhost",
  ], {
    cwd: FRONTEND_ROOT,
    env: {
      ...process.env,
      NUXT_CART_APP_CREDENTIAL: badCredential,
      NUXT_CART_ORIGIN: origin,
      NUXT_CART_TRUSTED_INGRESS: "",
      NUXT_IGNORE_LOCK: "1",
      PORT: String(port),
      NITRO_PORT: String(port),
      HOST: "localhost",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  await waitFor(async () => output.includes("Local:"), 90000, "mismatch dev server").catch((error) => {
    child.kill();
    throw new Error(`${error.message}; ${redact(output).slice(-300)}`);
  });
  let healthOk = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const health = await fetch(`${origin}/api/health`);
      if (health.ok) {
        healthOk = true;
        break;
      }
    } catch {
      healthOk = false;
    }
    await sleep(250);
  }
  if (!healthOk) {
    child.kill();
    throw new Error(`mismatch health failed; ${redact(output).slice(-300)}`);
  }
  return {
    origin,
    stop: async () => {
      child.kill();
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", resolveExit)),
        sleep(4000),
      ]);
    },
  };
}

async function proxyReads(page, guestValue) {
  page.fetchHandler = async (params) => {
    const url = new URL(params.request.url);
    const isRead = params.request.method === "GET" && (url.pathname === "/api/cart" || url.pathname === "/api/cart/");
    if (!isRead) {
      await page.send("Fetch.continueRequest", { requestId: params.requestId });
      return;
    }
    const proxied = await fetch(`${ORIGIN}/api/cart`, {
      headers: {
        accept: "application/json",
        cookie: `phoenix_guest_dev=${guestValue}`,
      },
    });
    const body = Buffer.from(await proxied.arrayBuffer()).toString("base64");
    await page.send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: proxied.status,
      responseHeaders: [
        { name: "content-type", value: "application/json; charset=utf-8" },
        { name: "cache-control", value: "private, no-store" },
      ],
      body,
    });
  };
  await page.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });
}

async function run() {
  const product = await catalogue();
  const enhanced = product.options.find((option) => option.name === "Enhanced");
  const none = product.options.find((option) => option.name === "None");
  const catalogueOk = product.price === "100.00"
    && enhanced?.id === 5
    && enhanced.adjustment === "25.00"
    && none?.id === 6
    && none.adjustment === "0.00"
    && none.default === true;
  record("catalogue", catalogueOk ? "PASS" : "FAIL", `product=${product.id}; price=${product.price}; options=${product.options.map((option) => `${option.id}:${option.name}:${option.adjustment}`).join(",")}`);
  if (!catalogueOk) return;

  const before = await snapshot();
  const browser = await launch();
  let mismatch;
  try {
    const version = await browser.version();
    console.log(`browser ${version}`);
    const context = await browser.context();
    const page = await browser.page(context);
    await page.open(PRODUCT);
    await waitFor(async () => (await page.text()).includes("Start a new basket"), 20000, "start action");
    const earlyCreates = page.traffic.filter((entry) => isCreate(entry.path) && entry.status);
    const earlySnapshot = await snapshot();
    record(
      "visit-without-start",
      earlyCreates.length === 0 && safeEqual(before, earlySnapshot) ? "PASS" : "FAIL",
      `creates=${earlyCreates.length}; sessions=${earlySnapshot.counts.sessions}; carts=${earlySnapshot.counts.carts}`,
    );
    if (earlyCreates.length !== 0) return;

    const fromStart = page.traffic.length;
    await page.clickButton("Start a new basket");
    await waitFor(async () => /add to cart/i.test(await page.text()) && !(await page.text()).includes("Start a new basket"), 20000, "basket ready");
    if (!(await page.clickLabel("Enhanced")) || !(await page.clickLabel("None"))) {
      record("start-add", "FAIL", "Enhanced or None could not be selected");
      return;
    }
    const fromAdd = page.traffic.length;
    if (!(await page.clickButton("Add to Cart"))) {
      record("start-add", "FAIL", "Add to Cart could not be clicked");
      return;
    }
    await waitFor(async () => (await page.text()).includes("added to your cart"), 20000, "add success");
    const added = await lineFacts(page, "POST", "/api/cart/add", 201, fromAdd)
      || await lineFacts(page, "POST", "/api/cart/add", 200, fromAdd);
    const started = await page.responseFacts("POST", "/api/cart/create", 201, fromStart);
    const addOk = added
      && added.configured === "125.00"
      && added.line === "125.00"
      && added.total === "125.00"
      && added.quantity === 1
      && added.optionIds.includes("5")
      && added.optionIds.includes("6")
      && started?.id
      && added.id === started.id;
    record("start-add", addOk ? "PASS" : "FAIL", `create=${started?.status || "none"}; add=${added?.status || "none"}; configured=${added?.configured || "none"}; line=${added?.line || "none"}; total=${added?.total || "none"}; options=${(added?.optionIds || []).join(",") || "none"}`);
    if (!addOk) return;

    await page.open(CART);
    const fromReload = page.traffic.length;
    await page.send("Page.reload", { ignoreCache: true });
    const reloaded = await waitFor(async () => {
      const facts = await page.responseFacts("GET", "/api/cart", 200, fromReload);
      return facts?.id === started.id ? facts : null;
    }, 20000, "reloaded cart");
    const reloadText = await page.text();
    const reloadOk = reloaded?.id === started.id
      && reloaded.optionIds.includes("5")
      && reloaded.optionIds.includes("6")
      && reloaded.total === "125.00"
      && reloadText.includes("Enhanced")
      && reloadText.includes("None");
    record("reload", reloadOk ? "PASS" : "FAIL", `sameId=${reloaded?.id === started.id}; total=${reloaded?.total || "none"}; options=${(reloaded?.optionIds || []).join(",") || "none"}`);
    if (!reloadOk) return;

    const fromIncrease = page.traffic.length;
    if (!(await page.clickIncrease())) {
      record("increase", "FAIL", "Increase could not be clicked");
      return;
    }
    const increased = await waitFor(async () => lineFacts(page, "POST", "/api/cart/update", 200, fromIncrease), 20000, "quantity update");
    const updates = page.traffic.slice(fromIncrease).filter((entry) => entry.path === "/api/cart/update" && entry.status);
    const increaseOk = updates.length === 1
      && increased.quantity === 2
      && increased.total === "250.00"
      && increased.configured === "125.00"
      && increased.line === "250.00"
      && increased.id === started.id;
    record("increase", increaseOk ? "PASS" : "FAIL", `updates=${updates.length}; quantity=${increased?.quantity ?? "none"}; total=${increased?.total || "none"}; line=${increased?.line || "none"}`);
    if (!increaseOk) return;

    const owned = await snapshot(started.id);
    const ownedOk = owned.counts.sessions === before.counts.sessions + 1
      && owned.counts.carts === before.counts.carts + 1
      && owned.cart?.items?.length === 1
      && owned.cart.items[0].quantity === 2
      && owned.cart.items[0].options.join(",") === "5,6";
    record("owned-basket", ownedOk ? "PASS" : "FAIL", `sessions=${owned.counts.sessions}; carts=${owned.counts.carts}; quantity=${owned.cart?.items?.[0]?.quantity ?? "none"}; options=${owned.cart?.items?.[0]?.options?.join(",") || "none"}`);
    if (!ownedOk) return;

    const guest = await guestCookie(page);
    const app = credential();
    const noApp = await djangoCall("create/", { method: "POST", headers: { "content-type": "application/json" }, body: { action: "start" } });
    const forged = await djangoCall("create/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        "do-connecting-ip": "203.0.113.10",
        "x-phoenix-shopper-address": "203.0.113.10",
      },
      body: { action: "start" },
    });
    const bearerOnly = await djangoCall("", {
      headers: { authorization: `Bearer ${guest.value}` },
    });
    const missingAddress = await djangoCall("create/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-phoenix-app-credential": app,
      },
      body: { action: "start" },
    });
    const malformedAddress = await djangoCall("create/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-phoenix-app-credential": app,
        "x-phoenix-shopper-address": "203.0.113.10, 198.51.100.8",
      },
      body: { action: "start" },
    });
    const missingGuest = await djangoCall("", {
      headers: {
        "x-phoenix-app-credential": app,
        "x-phoenix-shopper-address": "203.0.113.10",
      },
    });
    const guestDenied = await djangoCall("", {
      headers: {
        "x-phoenix-app-credential": app,
        "x-phoenix-shopper-address": "203.0.113.10",
        authorization: `Bearer ${"A".repeat(43)}`,
      },
    });
    const afterDirect = await snapshot(started.id);
    const directOk = [noApp, forged, bearerOnly, missingAddress, malformedAddress].every((result) => result.status === 503 && result.code === "CART_APPLICATION_REJECTED" && !result.redirected)
      && missingGuest.status === 401
      && missingGuest.code === "CART_ACCESS_UNAVAILABLE"
      && guestDenied.status === 401
      && guestDenied.code === "CART_ACCESS_UNAVAILABLE"
      && !guestDenied.redirected
      && safeEqual(afterDirect, owned);
    record("direct-django", directOk ? "PASS" : "FAIL", `noApp=${noApp.status}:${noApp.code}; forged=${forged.status}:${forged.code}; bearer=${bearerOnly.status}:${bearerOnly.code}; missingAddress=${missingAddress.status}:${missingAddress.code}; malformed=${malformedAddress.status}:${malformedAddress.code}; missingGuest=${missingGuest.status}:${missingGuest.code}; guest401=${guestDenied.status}:${guestDenied.code}; unchanged=${safeEqual(afterDirect, owned)}`);
    if (!directOk) return;

    mismatch = await startMismatch(differentCredential(app));
    const failedPage = await browser.page(context);
    const fromFailed = failedPage.traffic.length;
    await failedPage.open(`${mismatch.origin}/cart`);
    await waitFor(async () => (await failedPage.text()).includes(UNCERTAIN), 20000, "service failure");
    const failedText = await failedPage.text();
    const failedGet = failedPage.traffic.slice(fromFailed).filter((entry) => entry.method === "GET" && entry.path === "/api/cart" && entry.status);
    const failedWrites = failedPage.traffic.slice(fromFailed).filter((entry) => ["/api/cart/add", "/api/cart/update", "/api/cart/create", "/api/cart/reset"].includes(entry.path) && entry.status);
    const failedCodes = [];
    for (const entry of failedGet) {
      const payload = await failedPage.send("Network.getResponseBody", { requestId: entry.requestId }).catch(() => null);
      const raw = payload ? (payload.base64Encoded ? Buffer.from(payload.body, "base64").toString("utf8") : payload.body) : "";
      try {
        failedCodes.push(JSON.parse(raw).code || "");
      } catch {
        failedCodes.push("");
      }
    }
    const failedCookie = await guestCookie(failedPage);
    const failedOk = failedGet.length === 2
      && failedGet.every((entry) => entry.status === 503)
      && failedCodes.every((code) => code === "CART_SERVICE_UNAVAILABLE")
      && failedWrites.length === 0
      && failedText.includes(UNCERTAIN)
      && !failedText.includes(RECOVERY)
      && failedText.includes("Refresh basket")
      && cookieSame(guest, failedCookie);
    record("mismatch-get", failedOk ? "PASS" : "FAIL", `gets=${failedGet.map((entry) => entry.status).join(",") || "none"}; codes=${failedCodes.join(",") || "none"}; writes=${failedWrites.length}; refresh=${failedText.includes("Refresh basket")}; recovery=${failedText.includes(RECOVERY)}; cookieUnchanged=${cookieSame(guest, failedCookie)}`);

    const readyPage = await browser.page(context);
    await proxyReads(readyPage, guest.value);
    await readyPage.open(`${mismatch.origin}/cart`);
    await waitFor(async () => {
      const text = await readyPage.text();
      return text.includes("Enhanced") && text.includes("£250.00") ? text : "";
    }, 20000, "ready mismatch basket");
    const fromMutation = readyPage.traffic.length;
    const clicked = await readyPage.clickIncrease();
    let mutation = null;
    if (clicked) {
      mutation = await waitFor(async () => readyPage.responseFacts("POST", "/api/cart/update", 503, fromMutation), 20000, "rejected update").catch(() => null);
    }
    const mutationPosts = readyPage.traffic.slice(fromMutation).filter((entry) => entry.path === "/api/cart/update" && entry.method === "POST" && entry.status);
    const afterMutation = await snapshot(started.id);
    const mutationOk = clicked === true
      && mutationPosts.length === 1
      && mutation?.code === "CART_SERVICE_UNAVAILABLE"
      && safeEqual(afterMutation, owned);
    record("mismatch-mutation", mutationOk ? "PASS" : "FAIL", `clicked=${clicked === true}; posts=${mutationPosts.length}; code=${mutation?.code || "none"}; unchanged=${safeEqual(afterMutation, owned)}`);

    const fromReset = readyPage.traffic.length;
    const resetResult = await readyPage.eval(`(async () => {
      const issued = await fetch("/api/cart/csrf", { headers: { accept: "application/json", "x-phoenix-csrf-request": "1" }, credentials: "same-origin" });
      const issuedBody = await issued.json();
      const token = typeof issuedBody.csrf_token === "string" ? issuedBody.csrf_token : "";
      const reset = await fetch("/api/cart/reset", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json", "x-phoenix-csrf": token },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await reset.json();
      return { csrf: issued.status, status: reset.status, code: typeof body.code === "string" ? body.code : "" };
    })()`, true);
    const resetPosts = readyPage.traffic.slice(fromReset).filter((entry) => entry.path === "/api/cart/reset" && entry.status);
    const resetCookie = await guestCookie(readyPage);
    const afterReset = await snapshot(started.id);
    const resetOk = resetResult?.csrf === 200
      && resetResult.status === 503
      && resetResult.code === "CART_TEMPORARILY_UNAVAILABLE"
      && resetResult.code !== "CART_ACCESS_UNAVAILABLE"
      && resetPosts.length === 1
      && cookieSame(guest, resetCookie)
      && safeEqual(afterReset, owned);
    record("mismatch-reset", resetOk ? "PASS" : "FAIL", `csrf=${resetResult?.csrf || "none"}; status=${resetResult?.status || "none"}; code=${resetResult?.code || "none"}; posts=${resetPosts.length}; cookieUnchanged=${cookieSame(guest, resetCookie)}; unchanged=${safeEqual(afterReset, owned)}`);

    await mismatch.stop();
    mismatch = null;
    const fromRestore = page.traffic.length;
    await page.open(CART);
    await page.send("Page.reload", { ignoreCache: true });
    const restored = await waitFor(async () => {
      const facts = await page.responseFacts("GET", "/api/cart", 200, fromRestore);
      return facts?.id === started.id ? facts : null;
    }, 20000, "restored cart");
    const restoreCreates = page.traffic.slice(fromRestore).filter((entry) => isCreate(entry.path) && entry.status);
    const restoreResets = page.traffic.slice(fromRestore).filter((entry) => entry.path === "/api/cart/reset" && entry.status);
    const restoredCookie = await guestCookie(page);
    const restoreText = await page.text();
    const afterRestore = await snapshot(started.id);
    const restoreOk = restored?.id === started.id
      && restored.total === "250.00"
      && restored.optionIds.includes("5")
      && restored.optionIds.includes("6")
      && restoreCreates.length === 0
      && restoreResets.length === 0
      && cookieSame(guest, restoredCookie)
      && restoreText.includes("Enhanced")
      && safeEqual(afterRestore, owned);
    record("restored-access", restoreOk ? "PASS" : "FAIL", `sameId=${restored?.id === started.id}; total=${restored?.total || "none"}; creates=${restoreCreates.length}; resets=${restoreResets.length}; cookieUnchanged=${cookieSame(guest, restoredCookie)}; unchanged=${safeEqual(afterRestore, owned)}`);
  } catch (error) {
    record("runner", "FAIL", error.message);
  } finally {
    if (mismatch) await mismatch.stop();
    await browser.close();
  }
}

await run();
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
