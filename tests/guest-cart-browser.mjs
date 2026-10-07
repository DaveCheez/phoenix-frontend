// Local Edge acceptance checks for the guest cart. Fresh user-data directories only.
// Speaks to http://localhost:3000. Does not print cookies, CSRF, or guest tokens.

import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ORIGIN = "http://localhost:3000";
export const PRODUCT = `${ORIGIN}/product/guest-cart-integration-test`;
export const CART = `${ORIGIN}/cart`;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export const UNCERTAIN = "We could not confirm the latest basket update. Check your basket before trying the change again.";
const LAST_CONFIRMED = "Last confirmed basket — the latest change is not confirmed.";
const LOCKS_MESSAGE = "This browser cannot safely update the basket. Use a current browser, or contact Phoenix Vanz.";

const results = [];

function record(result) {
  results.push(result);
  console.log(`${result.id} ${result.status}${result.detail ? ` — ${result.detail}` : ""}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

class Browser {
  constructor(ws, child, profile) {
    this.ws = ws;
    this.child = child;
    this.profile = profile;
    this.nextId = 0;
    this.pending = new Map();
    this.sessions = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
        return;
      }
      if (message.sessionId && message.method) {
        this.sessions.get(message.sessionId)?.onEvent(message);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async version() {
    const version = await this.send("Browser.getVersion");
    return version.product || version.userAgent || "Edge";
  }

  async context() {
    const created = await this.send("Target.createBrowserContext");
    return created.browserContextId;
  }

  async page(browserContextId) {
    const created = await this.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const attached = await this.send("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    const page = new Page(this, attached.sessionId);
    this.sessions.set(attached.sessionId, page);
    await page.send("Page.enable");
    await page.send("Network.enable");
    await page.send("Runtime.enable");
    return page;
  }

  async dispose(browserContextId) {
    await this.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }

  async close() {
    this.child.kill();
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      sleep(3000),
    ]);
    await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}

class Page {
  constructor(browser, sessionId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.traffic = [];
    this.requests = new Map();
    this.fetchHandler = null;
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  onEvent(message) {
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params.request;
      let quantity;
      let action;
      if (request.postData) {
        try {
          const parsed = JSON.parse(request.postData);
          if (parsed && typeof parsed === "object") {
            if (parsed.quantity != null) quantity = parsed.quantity;
            if (typeof parsed.action === "string") action = parsed.action;
          }
        } catch {
          quantity = undefined;
        }
      }
      this.requests.set(message.params.requestId, {
        at: Date.now(),
        method: request.method,
        path: new URL(request.url).pathname,
        quantity,
        action,
      });
      if (!this.sent) this.sent = [];
      this.sent.push({
        at: Date.now(),
        method: request.method,
        path: new URL(request.url).pathname,
        quantity,
        action,
      });
    }
    if (message.method === "Network.responseReceived") {
      const pending = this.requests.get(message.params.requestId);
      const path = pending?.path || new URL(message.params.response.url).pathname;
      const names = cookieNames(message.params.response.headers);
      this.traffic.push({
        at: Date.now(),
        method: pending?.method || "GET",
        path,
        status: message.params.response.status,
        quantity: pending?.quantity,
        action: pending?.action,
        requestId: message.params.requestId,
        setCookieNames: names,
      });
    }
    if (message.method === "Fetch.requestPaused" && this.fetchHandler) {
      this.fetchHandler(message.params).catch((error) => {
        this.fetchError = error;
      });
    }
  }

  async open(url) {
    const pathname = new URL(url).pathname;
    await this.send("Page.navigate", { url });
    await waitFor(async () => {
      const current = await this.eval("location.pathname").catch(() => "");
      const text = await this.text().catch(() => "");
      return current === pathname && text.includes("Phoenix Vanz") ? text : "";
    }, 20000, url);
  }

  async text() {
    const result = await this.send("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText : ''",
      returnByValue: true,
    });
    return result.result?.value || "";
  }

  async clickIncrease() {
    return this.eval(`(() => {
      const button = document.querySelector('button[aria-label^="Increase "]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
  }

  async eval(expression, awaitPromise = false) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Page script failed");
    }
    return result.result?.value;
  }

  async clickButton(label) {
    return this.eval(`(() => {
      const button = [...document.querySelectorAll("button")].find((element) => (element.innerText || "").toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
  }

  async clickLabel(label) {
    return this.eval(`(() => {
      const match = [...document.querySelectorAll("label")].find((element) => (element.innerText || "").includes(${JSON.stringify(label)}));
      const input = match && match.querySelector("input");
      if (!input) return false;
      input.click();
      return input.checked === true;
    })()`);
  }

  paths(method, path, after = 0) {
    return this.traffic.filter((entry) => entry.method === method && entry.path === path && entry.at >= after);
  }

  mark() {
    const at = Date.now();
    for (const entry of this.traffic) if (!entry.at) entry.at = at;
    return at;
  }

  async responseFacts(method, path, status, from = 0) {
    const entry = [...this.traffic.slice(from)].reverse().find((item) =>
      item.method === method && item.path === path && item.status === status && item.requestId);
    if (!entry) return null;
    let payload;
    try {
      payload = await this.send("Network.getResponseBody", { requestId: entry.requestId });
    } catch {
      return { status, unavailable: true };
    }
    const raw = payload.base64Encoded ? Buffer.from(payload.body, "base64").toString("utf8") : payload.body;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status, code: "", leaked: false };
    }
    const cart = parsed.cart && typeof parsed.cart === "object" ? parsed.cart : null;
    const optionNames = [];
    const optionIds = [];
    for (const item of Array.isArray(cart?.items) ? cart.items : []) {
      for (const option of Array.isArray(item?.selected_options) ? item.selected_options : []) {
        if (typeof option?.option_name === "string") optionNames.push(option.option_name);
        if (option?.option_id != null) optionIds.push(String(option.option_id));
      }
    }
    return {
      status,
      leaked: Object.prototype.hasOwnProperty.call(parsed, "guest_access"),
      code: typeof parsed.code === "string" ? parsed.code : "",
      id: typeof cart?.id === "string" ? cart.id : "",
      total: typeof cart?.total === "string" ? cart.total : "",
      count: cart?.item_count ?? null,
      optionNames,
      optionIds,
      setCookieNames: entry.setCookieNames || [],
      action: entry.action || "",
    };
  }
}

function cookieNames(headers = {}) {
  const raw = headers["set-cookie"] || headers["Set-Cookie"] || "";
  return [...String(raw).matchAll(/(?:^|[\n,])\s*([A-Za-z0-9_-]+)=/g)].map((match) => match[1]);
}

export async function launch() {
  const profile = await mkdtemp(join(tmpdir(), "phoenix-guest-cart-"));
  const port = 9333;
  const child = spawn(EDGE, [
    "--headless=new",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--disable-sync",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });
  let version;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await response.json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version?.webSocketDebuggerUrl) {
    child.kill();
    throw new Error("Edge remote debugging did not start");
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new Browser(ws, child, profile);
}

export function isCreate(path) {
  return path === "/api/cart/create" || path === "/api/cart/create/";
}

async function cookieFlags(page) {
  const listed = await page.send("Network.getCookies", { urls: [ORIGIN] });
  return (listed.cookies || [])
    .filter((cookie) => cookie.name.includes("phoenix_guest") || cookie.name.includes("phoenix_cart"))
    .map((cookie) => ({
      name: cookie.name,
      httpOnly: cookie.httpOnly === true,
      present: typeof cookie.value === "string" && cookie.value.length > 0,
    }));
}

async function responseHasGuestAccess(page) {
  const expression = `fetch("/api/cart", { headers: { accept: "application/json" } }).then((response) => response.text()).then((text) => text.includes("guest_access"))`;
  return page.eval(expression, true);
}

async function scenarioBasket(browser) {
  const id = "B";
  const context = await browser.context();
  try {
    const page = await browser.page(context);
    const before = Date.now();
    await page.open(PRODUCT);
    await waitFor(async () => (await page.text()).includes("Start a new basket"), 15000, "start action");
    const issuedEarly = page.traffic.filter((entry) => isCreate(entry.path));
    if (issuedEarly.length !== 0) {
      record({ id, status: "FAIL", detail: "a page visit issued a cart session" });
      return;
    }
    const guestVisible = await page.eval("document.cookie.includes('phoenix_guest')");
    if (guestVisible) {
      record({ id, status: "FAIL", detail: "guest cookie was visible to page script before start" });
      return;
    }
    const cookiesBefore = await cookieFlags(page);
    await page.clickButton("Start a new basket");
    try {
      await waitFor(async () => /add to cart/i.test(await page.text()) && !(await page.text()).includes("Start a new basket"), 20000, "basket ready");
    } catch (error) {
      const text = await page.text();
      const phrases = ["Start a new basket", "Working", "Add to Cart", "could not confirm", "not sent", "rejected", "unavailable", "previous basket", "empty basket"].filter((phrase) => text.includes(phrase));
      record({
        id,
        status: "FAIL",
        detail: `${error.message}; phrases=${phrases.join("|") || "none"}; traffic=${page.traffic.map((entry) => `${entry.method} ${entry.path} ${entry.status}`).join("; ")}`,
      });
      return;
    }
    if (!(await page.clickLabel("Enhanced"))) {
      record({ id, status: "FAIL", detail: "Enhanced option could not be selected" });
      return;
    }
    if (!(await page.clickButton("Add to Cart"))) {
      record({ id, status: "FAIL", detail: "Add to Cart could not be clicked" });
      return;
    }
    await waitFor(async () => (await page.text()).includes("added to your cart"), 20000, "add success");
    await page.open(CART);
    const cartText = await waitFor(async () => {
      const text = await page.text();
      return text.includes("Enhanced") && text.includes("£") ? text : "";
    }, 15000, "cart display");
    await page.send("Page.reload", { ignoreCache: true });
    const reloaded = await waitFor(async () => {
      const text = await page.text();
      return text.includes("Enhanced") ? text : "";
    }, 15000, "reloaded cart");
    const flags = await cookieFlags(page);
    const guest = flags.find((cookie) => cookie.name === "phoenix_guest_dev");
    const leaked = await responseHasGuestAccess(page);
    const jsSeesGuest = await page.eval("document.cookie.includes('phoenix_guest')");
    const creates = page.traffic.filter((entry) => isCreate(entry.path));
    const money = (reloaded.match(/£[0-9]+\.[0-9]{2}/g) || []).join(",");
    const ok = creates.filter((entry) => entry.status === 201).length === 1
      && cookiesBefore.length === 0
      && guest?.httpOnly === true
      && guest.present === true
      && leaked === false
      && jsSeesGuest === false
      && cartText.includes("Enhanced")
      && reloaded.includes("Enhanced");
    record({
      id,
      status: ok ? "PASS" : "FAIL",
      detail: `creates=${creates.map((entry) => entry.status).join(",") || "none"}; cookieBefore=${cookiesBefore.length}; cookieHttpOnly=${guest?.httpOnly === true}; guestAccessInJson=${leaked}; prices=${money}; paths=${page.traffic.map((entry) => `${entry.method} ${entry.path} ${entry.status}`).filter((entry) => entry.includes("/api/cart")).join(" | ")}`,
      startedAt: before,
    });
  } catch (error) {
    record({ id, status: "FAIL", detail: error.message });
  } finally {
    await browser.dispose(context);
  }
}

async function scenarioTwoStarts(browser) {
  const id = "C";
  const context = await browser.context();
  try {
    const first = await browser.page(context);
    const second = await browser.page(context);
    await first.open(CART);
    await second.open(CART);
    await waitFor(async () => (await first.text()).includes("Start a new basket"), 15000, "first start");
    await waitFor(async () => (await second.text()).includes("Start a new basket"), 15000, "second start");
    await Promise.all([
      first.clickButton("Start a new basket"),
      second.clickButton("Start a new basket"),
    ]);
    await waitFor(async () => {
      const one = await first.text();
      const two = await second.text();
      return !one.includes("Working") && !two.includes("Working") && !one.includes("Loading your cart") && !two.includes("Loading your cart");
    }, 20000, "both starts to settle");
    await sleep(500);
    const combined = [...first.traffic, ...second.traffic].filter((entry) => entry.path === "/api/cart/create");
    const issuances = combined.filter((entry) => entry.status === 201);
    const hung = (await first.text()).includes("Working") || (await second.text()).includes("Working");
    const sameEmpty = (await first.text()).includes("Your cart is empty") && (await second.text()).includes("Your cart is empty");
    record({
      id,
      status: issuances.length === 1 && !hung && sameEmpty ? "PASS" : "FAIL",
      detail: `createStatuses=${combined.map((entry) => entry.status).join(",") || "none"}; newIssuances=${issuances.length}; hung=${hung}; bothEmpty=${sameEmpty}`,
    });
  } catch (error) {
    record({ id, status: "FAIL", detail: error.message });
  } finally {
    await browser.dispose(context);
  }
}

async function prepareLine(page) {
  await page.open(PRODUCT);
  await waitFor(async () => (await page.text()).includes("Start a new basket"), 15000, "start");
  await page.clickButton("Start a new basket");
  await waitFor(async () => /add to cart/i.test(await page.text()) && !(await page.text()).includes("Start a new basket"), 20000, "ready to add");
  if (!(await page.clickLabel("Enhanced"))) throw new Error("Enhanced was not selected");
  if (!(await page.clickButton("Add to Cart"))) throw new Error("Add was not clicked");
  await waitFor(async () => (await page.text()).includes("added to your cart"), 20000, "added");
}

async function scenarioQuantity(browser) {
  const id = "D";
  const context = await browser.context();
  try {
    const first = await browser.page(context);
    await prepareLine(first);
    await first.open(CART);
    const second = await browser.page(context);
    await second.open(CART);
    await waitFor(async () => (await first.eval("document.querySelector('input[type=number]')?.value")) === "1", 15000, "first quantity");
    await waitFor(async () => (await second.eval("document.querySelector('input[type=number]')?.value")) === "1", 15000, "second quantity");
    const mark = Date.now();
    const clicked = await Promise.all([first.clickIncrease(), second.clickIncrease()]);
    if (clicked.some((value) => value !== true)) throw new Error("One increase control was not clicked");
    await waitFor(async () => {
      const updates = [...first.traffic, ...second.traffic].filter((entry) => entry.path === "/api/cart/update" && entry.status);
      return updates.length >= 2;
    }, 20000, "two quantity updates");
    await first.open(CART);
    await second.open(CART);
    await waitFor(async () => (await first.eval("document.querySelector('input[type=number]')?.value")) === "3", 15000, "first refreshed quantity");
    await waitFor(async () => (await second.eval("document.querySelector('input[type=number]')?.value")) === "3", 15000, "second refreshed quantity");
    const left = await first.eval("document.querySelector('input[type=number]')?.value");
    const right = await second.eval("document.querySelector('input[type=number]')?.value");
    const text = await first.text();
    const quantities = [...first.sent, ...second.sent]
      .filter((entry) => entry.path === "/api/cart/update" && entry.quantity != null && entry.at >= mark - 1000)
      .sort((left, right) => left.at - right.at)
      .map((entry) => entry.quantity);
    const prices = (text.match(/£[0-9]+\.[0-9]{2}/g) || []).join(",");
    const oneLine = (text.match(/Guest cart integration test/g) || []).length === 1;
    record({
      id,
      status: quantities.join(",") === "2,3" && left === "3" && right === "3" && oneLine ? "PASS" : "FAIL",
      detail: `submitted=${quantities.join(",") || "none"}; tabs=${left},${right}; prices=${prices}`,
    });
  } catch (error) {
    record({ id, status: "FAIL", detail: error.message });
  } finally {
    await browser.dispose(context);
  }
}

async function forwardPaused(params) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(params.request.headers || {})) {
    const key = name.toLowerCase();
    if (["cookie", "content-type", "accept", "origin", "x-phoenix-csrf"].includes(key)) {
      headers.set(name, value);
    }
  }
  return fetch(params.request.url, {
    method: params.request.method,
    headers,
    body: params.request.postData || undefined,
    redirect: "manual",
  });
}

async function scenarioResponseLoss(browser) {
  const id = "E";
  const context = await browser.context();
  try {
    const page = await browser.page(context);
    await prepareLine(page);
    await page.open(CART);
    await waitFor(async () => (await page.eval("document.querySelector('input[type=number]')?.value")) === "1", 15000, "quantity 1");
    let forwarded = 0;
    let confirmed;
    page.fetchHandler = async (params) => {
      try {
        if (!params.request.url.includes("/api/cart/update") || forwarded > 0) {
          await page.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Aborted" });
          return;
        }
        forwarded += 1;
        const response = await forwardPaused(params);
        const body = await response.text();
        const parsed = JSON.parse(body);
        confirmed = {
          status: response.status,
          success: parsed.success === true,
          quantity: parsed.cart?.items?.[0]?.quantity,
          total: parsed.cart?.total,
        };
      } finally {
        await page.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Aborted" }).catch(() => {});
      }
    };
    await page.send("Fetch.enable", {
      patterns: [{ urlPattern: "*://localhost:3000/api/cart/update*", requestStage: "Request" }],
    });
    const before = page.traffic.length;
    await page.eval(`(() => { const button = document.querySelector('button[aria-label^="Increase "]'); button.click(); return true; })()`);
    await waitFor(async () => (await page.text()).includes(UNCERTAIN), 15000, "uncertainty message");
    await sleep(1000);
    const text = await page.text();
    const updatesAfter = page.traffic.slice(before).filter((entry) => entry.path === "/api/cart/update" && entry.status && entry.status < 400);
    await page.send("Fetch.disable");
    page.fetchHandler = null;
    const refreshMark = page.traffic.length;
    if (!(await page.clickButton("Refresh basket"))) throw new Error("Refresh basket was not clicked");
    await waitFor(async () => (await page.eval("document.querySelector('input[type=number]')?.value")) === "2", 15000, "refreshed quantity");
    const after = page.traffic.slice(refreshMark);
    const reads = after.filter((entry) => entry.method === "GET" && entry.path === "/api/cart");
    const writes = after.filter((entry) => entry.path === "/api/cart/update" || entry.path === "/api/cart/create");
    const ok = confirmed?.success === true
      && confirmed.quantity === 2
      && text.includes(LAST_CONFIRMED)
      && !text.includes("Cart quantity updated")
      && forwarded === 1
      && updatesAfter.length === 0
      && reads.length >= 1
      && writes.length === 0;
    record({
      id,
      status: ok ? "PASS" : "FAIL",
      detail: `forwarded=${forwarded}; djangoStatus=${confirmed?.status}; confirmedQuantity=${confirmed?.quantity}; total=${confirmed?.total}; refreshGets=${reads.length}; refreshWrites=${writes.length}`,
    });

    try {
      await page.open(PRODUCT);
      const selected = await page.clickLabel("Standard");
      let failed = false;
      page.fetchHandler = async (params) => {
        if (params.request.url.includes("/api/cart/add")) {
          failed = true;
          await page.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" });
          return;
        }
        await page.send("Fetch.continueRequest", { requestId: params.requestId });
      };
      await page.send("Fetch.enable", {
        patterns: [{ urlPattern: "*://localhost:3000/api/cart/add*", requestStage: "Request" }],
      });
      const clicked = await page.clickButton("Add to Cart");
      await waitFor(async () => (await page.text()).includes(UNCERTAIN) || (await page.text()).includes("not sent"), 15000, "failed add");
      const radios = await page.eval(`JSON.stringify([...document.querySelectorAll("input[type=radio]")].map((input) => ({ checked: input.checked, name: input.closest("label")?.innerText.split("\\n")[0] || "" })))`);
      const parsedRadios = JSON.parse(radios);
      const standard = parsedRadios.find((radio) => radio.name.includes("Standard"));
      record({
        id: "E-add",
        status: failed && standard?.checked === true ? "PASS" : "FAIL",
        detail: `abortedAdd=${failed}; standardStillSelected=${standard?.checked === true}; selectedClick=${selected}; addClick=${clicked}`,
      });
    } catch (error) {
      const text = await page.text();
      const phrases = [UNCERTAIN, "not sent", "added to your cart", "Adding", "Choose an option"].filter((phrase) => text.includes(phrase));
      record({
        id: "E-add",
        status: "FAIL",
        detail: `${error.message}; phrases=${phrases.join("|") || "none"}; adds=${page.traffic.filter((entry) => entry.path === "/api/cart/add").map((entry) => entry.status).join(",") || "none"}`,
      });
    }
  } catch (error) {
    record({ id, status: "FAIL", detail: error.message });
  } finally {
    await browser.dispose(context);
  }
}

async function scenarioRateLimit(browser) {
  const id = "F";
  const context = await browser.context();
  try {
    const page = await browser.page(context);
    await page.open(PRODUCT);
    await waitFor(async () => (await page.text()).includes("Start a new basket"), 15000, "start");
    await page.clickButton("Start a new basket");
    await waitFor(async () => !(await page.text()).includes("Start a new basket"), 20000, "started");
    await page.clickLabel("Enhanced");
    let injected = 0;
    page.fetchHandler = async (params) => {
      if (!params.request.url.includes("/api/cart/add") || injected > 0) {
        await page.send("Fetch.continueRequest", { requestId: params.requestId });
        return;
      }
      injected += 1;
      await page.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 429,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: btoa(JSON.stringify({ success: false, code: "CART_SERVICE_UNAVAILABLE", error: "injected" })),
      });
    };
    await page.send("Fetch.enable", {
      patterns: [{ urlPattern: "*://localhost:3000/api/cart/add*", requestStage: "Request" }],
    });
    await page.clickButton("Add to Cart");
    await waitFor(async () => (await page.text()).includes(UNCERTAIN), 15000, "429 message");
    await sleep(800);
    const text = await page.text();
    const radios = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll("input[type=radio]")].map((input) => ({ checked: input.checked, name: input.closest("label")?.innerText.split("\\n")[0] || "" })))`));
    const enhanced = radios.find((radio) => radio.name.includes("Enhanced"));
    const adds = page.traffic.filter((entry) => entry.path === "/api/cart/add" && entry.status >= 200 && entry.status < 300);
    await page.send("Fetch.disable");
    page.fetchHandler = null;
    const mark = page.traffic.length;
    await page.clickButton("Refresh basket");
    await waitFor(async () => page.traffic.slice(mark).some((entry) => entry.method === "GET" && entry.path === "/api/cart" && entry.status), 15000, "refresh read");
    const after = page.traffic.slice(mark);
    const ok = injected === 1
      && text.includes(UNCERTAIN)
      && !text.includes("added to your cart")
      && enhanced?.checked === true
      && adds.length === 0
      && after.some((entry) => entry.method === "GET" && entry.path === "/api/cart")
      && !after.some((entry) => entry.path === "/api/cart/create" || entry.path === "/api/cart/add");
    record({
      id,
      status: ok ? "PASS" : "FAIL",
      detail: `injected429=${injected}; forwardedAdds=${adds.length}; enhancedRemains=${enhanced?.checked === true}; refreshGets=${after.filter((entry) => entry.method === "GET" && entry.path === "/api/cart").length}`,
    });
  } catch (error) {
    record({ id, status: "FAIL", detail: error.message });
  } finally {
    await browser.dispose(context);
  }
}

async function scenarioLocks(browser) {
  const id = "G";
  const context = await browser.context();
  try {
    const page = await browser.page(context);
    await prepareLine(page);
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get() { return undefined; } });",
    });
    await page.open(CART);
    const locksGone = await page.eval("typeof navigator.locks === 'undefined'");
    const text = await waitFor(async () => {
      const value = await page.text();
      return value.includes("Guest cart integration test") ? value : "";
    }, 15000, "readable basket");
    const before = page.traffic.length;
    await page.eval(`(() => { const button = document.querySelector('button[aria-label^="Increase "]'); if (!button) return false; button.click(); return true; })()`);
    await waitFor(async () => (await page.text()).includes(LOCKS_MESSAGE), 15000, "locks message");
    const afterText = await page.text();
    const contact = await page.eval("Boolean(document.querySelector('a[href=\"/contact\"]'))");
    await sleep(800);
    const writes = page.traffic.slice(before).filter((entry) => ["/api/cart/create", "/api/cart/update", "/api/cart/add", "/api/cart/reset"].includes(entry.path) && entry.status);
    record({
      id,
      status: locksGone && text.includes("£") && afterText.includes(LOCKS_MESSAGE) && contact && writes.length === 0 ? "PASS" : "FAIL",
      detail: `locksHidden=${locksGone}; contactLink=${contact}; writesAfter=${writes.length}`,
    });
  } catch (error) {
    record({ id, status: "FAIL", detail: error.message });
  } finally {
    await browser.dispose(context);
  }
}

const UNAVAILABLE = "We cannot reopen your previous basket. Start a new empty basket to continue.";
const MISSING_CART = "Your basket is no longer available. You can open a new empty basket.";
const FRONTEND_ROOT = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = "C:\\Users\\davec\\Dev\\Phoenix Vanz\\phoenix-vanz-backend-digitalocean-ready\\backend";
const BACKEND_PYTHON = "C:\\Users\\davec\\Dev\\Phoenix Vanz\\phoenix-vanz-backend-digitalocean-ready\\venv\\Scripts\\python.exe";

export function redact(text) {
  return String(text)
    .replace(/[0-9a-fA-F]{64}/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{43}/g, "[redacted]");
}

function commitOf(repository) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
}

function cartTraffic(page, from = 0) {
  return page.traffic.slice(from).filter((entry) => entry.path.startsWith("/api/cart") && entry.status);
}

function writes(entries) {
  return entries.filter((entry) =>
    entry.path === "/api/cart/create" || entry.path === "/api/cart/reset" || entry.path === "/api/cart/add");
}

class FixtureHelper {
  constructor(child) {
    this.child = child;
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = "";
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const waiting = this.pending.get(message.id);
        if (!waiting) continue;
        this.pending.delete(message.id);
        waiting.resolve(message);
      }
    });
  }

  call(action, extra = {}) {
    const id = ++this.nextId;
    this.child.stdin.write(JSON.stringify({ id, action, ...extra }) + "\n");
    return new Promise((resolve, reject) => {
      let timer;
      const fail = (error) => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      };
      this.child.once("exit", () => fail(new Error(`fixture helper stopped during ${action}: ${this.child.stderrText() || "no error output"}`)));
      timer = setTimeout(() => {
        fail(new Error(`fixture ${action} timed out: ${this.child.stderrText() || "no error output"}`));
      }, 60000);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          if (!message.ok) reject(new Error(message.error || `${action} failed`));
          else resolve(message);
        },
      });
    });
  }

  async close() {
    this.child.stdin.end();
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      sleep(3000),
    ]);
    if (this.child.exitCode == null) this.child.kill();
  }
}

function startFixtureHelper() {
  const child = spawn(BACKEND_PYTHON, [join(FRONTEND_ROOT, "guest-cart-fixture.py")], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PHOENIX_GUEST_CART_FIXTURE: "1",
      PHOENIX_BACKEND_ROOT: BACKEND_ROOT,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.setMaxListeners(30);
  child.stderrText = () => redact(stderr).slice(0, 300);
  return new FixtureHelper(child);
}

export async function guestCookie(page) {
  const listed = await page.send("Network.getCookies", { urls: [ORIGIN] });
  const cookie = (listed.cookies || []).find((item) => item.name === "phoenix_guest_dev");
  if (!cookie) return { present: false, httpOnly: false, expires: null, value: "" };
  return {
    present: cookie.value.length > 0,
    httpOnly: cookie.httpOnly === true,
    expires: cookie.expires,
    value: cookie.value,
  };
}

export function cookieSame(before, after) {
  return before.present === true
    && after.present === true
    && before.httpOnly === true
    && after.httpOnly === true
    && before.expires === after.expires
    && before.expires > Date.now() / 1000
    && before.value === after.value
    && before.value.length > 0;
}

async function prepareConfiguredLine(page) {
  await page.open(PRODUCT);
  await waitFor(async () => (await page.text()).includes("Start a new basket"), 15000, "start");
  const from = page.traffic.length;
  await page.clickButton("Start a new basket");
  await waitFor(async () => {
    const text = await page.text();
    const settled = /add to cart/i.test(text) && !text.includes("Start a new basket") && !text.includes("Working");
    const created = page.traffic.slice(from).some((entry) => isCreate(entry.path) && entry.status);
    return settled && created ? text : "";
  }, 20000, "ready to add");
  const started = await page.responseFacts("POST", "/api/cart/create", 201, from);
  if (!started?.id || started.leaked || started.unavailable) {
    const creates = page.traffic.slice(from).filter((entry) => isCreate(entry.path)).map((entry) => entry.status || "pending").join(",") || "none";
    throw new Error(`the start response did not include a cart id; creates=${creates}; unavailable=${started?.unavailable === true}`);
  }
  if (!(await page.clickLabel("Enhanced"))) throw new Error("Enhanced was not selected");
  if (!(await page.clickLabel("None"))) throw new Error("None was not selected");
  if (!(await page.clickButton("Add to Cart"))) throw new Error("Add was not clicked");
  await waitFor(async () => (await page.text()).includes("added to your cart"), 20000, "added");
  return started.id;
}

async function captureStartedCart(page, startedId) {
  await page.open(CART);
  await waitFor(async () => {
    const text = await page.text();
    return text.includes("Enhanced") && text.includes("£125.00") ? text : "";
  }, 15000, "configured price");
  const snapshot = await page.responseFacts("GET", "/api/cart", 200);
  if (!snapshot || snapshot.leaked || snapshot.unavailable || snapshot.id !== startedId) {
    throw new Error("the displayed cart did not match the start response");
  }
  const configured = snapshot.total === "125.00"
    && snapshot.count === 1
    && snapshot.optionIds.includes("5")
    && snapshot.optionIds.includes("6")
    && snapshot.optionNames.includes("Enhanced")
    && snapshot.optionNames.includes("None");
  if (!configured) {
    throw new Error(`configured line was not Enhanced and None at 125.00; options=${snapshot.optionIds.join(",") || "none"}; total=${snapshot.total}`);
  }
  return snapshot;
}

async function readBasket(page, phrase) {
  const from = page.traffic.length;
  await page.send("Page.reload", { ignoreCache: true });
  await waitFor(async () => {
    const text = await page.text();
    return text.includes(phrase) && !text.includes("Loading your cart") ? text : "";
  }, 20000, phrase);
  return { from, text: await page.text() };
}

async function scenarioCredentialLoss(browser, helper, id, action) {
  const context = await browser.context();
  let oldId = "";
  try {
    const page = await browser.page(context);
    const startedId = await prepareConfiguredLine(page);
    const snapshot = await captureStartedCart(page, startedId);
    oldId = snapshot.id;
    if (snapshot.total !== "125.00" || snapshot.count !== 1) {
      record({ id, status: "FAIL", detail: `price total=${snapshot.total}; count=${snapshot.count}` });
      return;
    }
    const beforeCookie = await guestCookie(page);
    const registered = await helper.call("register", { cart_id: oldId });
    if (registered.item_count !== 1 || registered.user_null !== true || registered.orders !== 0) {
      record({ id, status: "FAIL", detail: "registration guard rejected the new cart" });
      return;
    }
    await helper.call(action, { cart_id: oldId });
    const afterCookie = await guestCookie(page);
    const held = cookieSame(beforeCookie, afterCookie);
    const viewed = await readBasket(page, UNAVAILABLE);
    const beforeRecovery = cartTraffic(page, viewed.from);
    const premature = writes(beforeRecovery);
    const rejection = await page.responseFacts("GET", "/api/cart", 401, viewed.from);
    const recoveryFrom = page.traffic.length;
    if (!(await page.clickButton("Start a new basket"))) throw new Error("Start a new basket was not clicked");
    await waitFor(async () => {
      const text = await page.text();
      return text.includes("Your cart is empty.") && !text.includes(UNAVAILABLE) && !text.includes("Loading your cart") ? text : "";
    }, 20000, "recovered empty basket");
    const recovery = cartTraffic(page, recoveryFrom);
    const reset = recovery.find((entry) => entry.path === "/api/cart/reset");
    const created = recovery.find((entry) => entry.path === "/api/cart/create" && entry.action === "start");
    const recoveredCookie = await guestCookie(page);
    const credentialReplaced = recoveredCookie.present === true
      && recoveredCookie.httpOnly === true
      && recoveredCookie.expires > Date.now() / 1000
      && recoveredCookie.value !== beforeCookie.value;
    const reloadedFrom = page.traffic.length;
    await page.send("Page.reload", { ignoreCache: true });
    const reloaded = await waitFor(async () => {
      const text = await page.text();
      return text.includes("Your cart is empty.") && !text.includes("Start a new basket") && !text.includes("Loading your cart") ? text : "";
    }, 20000, "reloaded empty basket");
    const reloadWrites = writes(cartTraffic(page, reloadedFrom));
    const fresh = await page.responseFacts("GET", "/api/cart", 200, reloadedFrom);
    if (!fresh?.id || fresh.id === oldId || fresh.leaked) throw new Error("replacement cart id was not readable");
    await helper.call("register", { cart_id: fresh.id });
    const oldState = await helper.call("verify", { cart_id: oldId });
    const newState = await helper.call("verify", { cart_id: fresh.id });
    const ok = held
      && rejection?.code === "CART_ACCESS_UNAVAILABLE"
      && premature.length === 0
      && viewed.text.includes("Your previous basket will not be restored.")
      && reset?.status === 200
      && created?.status === 201
      && credentialReplaced
      && recovery.filter((entry) => entry.path === "/api/cart/add").length === 0
      && reloadWrites.length === 0
      && reloaded.includes("Your cart is empty.")
      && oldState.cart_exists === true
      && oldState.item_count === 1
      && oldState.token_unchanged === true
      && newState.cart_exists === true
      && newState.item_count === 0
      && newState.session_cart_id === fresh.id
      && oldState.session_cart_id === oldId
      && fresh.count === 0;
    const retained = action === "expire"
      ? oldState.expired === true && oldState.revoked === false
      : oldState.revoked === true && oldState.expired === false;
    record({
      id,
      status: ok && retained ? "PASS" : "FAIL",
      detail: `fixture=${action}; read=${rejection?.status || "none"} ${rejection?.code || "none"}; cookieHeld=${held}; credentialReplaced=${credentialReplaced}; writesBeforeRecovery=${premature.length}; reset=${reset?.status || "none"}; create=${created?.status || "none"}; setCookieNames=${(created?.setCookieNames || []).join(",") || "none"}; tokenUnchanged=${oldState.token_unchanged}; freshCount=${fresh?.count}; detailShown=${viewed.text.includes("Your previous basket will not be restored.")}; oldItems=${oldState.item_count}; oldExpired=${oldState.expired}; oldRevoked=${oldState.revoked}; newEmpty=${newState.item_count === 0}; sameOldCart=${oldState.session_cart_id === oldId}; reloadWrites=${reloadWrites.length}; total=${snapshot.total}`,
    });
  } catch (error) {
    record({ id, status: "FAIL", detail: `${redact(error.message)}; cart=${oldId || "unregistered"}` });
  } finally {
    await browser.dispose(context);
  }
}

async function scenarioMissingCart(browser, helper) {
  const id = "3";
  const context = await browser.context();
  let oldId = "";
  let page;
  try {
    page = await browser.page(context);
    const startedId = await prepareConfiguredLine(page);
    const snapshot = await captureStartedCart(page, startedId);
    oldId = snapshot.id;
    if (snapshot.total !== "125.00" || snapshot.count !== 1) {
      record({ id, status: "FAIL", detail: `price total=${snapshot.total}; count=${snapshot.count}` });
      return;
    }
    const beforeCookie = await guestCookie(page);
    const registered = await helper.call("register", { cart_id: oldId });
    if (registered.item_count !== 1) throw new Error("configured line was not stored");
    await helper.call("delete_cart", { cart_id: oldId });
    const afterDelete = await guestCookie(page);
    const viewed = await readBasket(page, MISSING_CART);
    const beforeAction = cartTraffic(page, viewed.from);
    const premature = writes(beforeAction);
    const rejection = await page.responseFacts("GET", "/api/cart", 409, viewed.from);
    const replaceFrom = page.traffic.length;
    if (!(await page.clickButton("Open an empty basket"))) throw new Error("Open an empty basket was not clicked");
    await waitFor(async () => {
      const text = await page.text();
      return text.includes("Your cart is empty.") && !text.includes(MISSING_CART) && !text.includes("Loading your cart") ? text : "";
    }, 20000, "replacement basket");
    const replaced = cartTraffic(page, replaceFrom);
    const create = replaced.find((entry) => entry.path === "/api/cart/create" && entry.action === "replace_missing");
    const issuedCookie = (create?.setCookieNames || []).some((name) => name.includes("phoenix_guest"));
    const afterReplace = await guestCookie(page);
    const credentialSame = cookieSame(beforeCookie, afterDelete) && cookieSame(beforeCookie, afterReplace);
    const reloadFrom = page.traffic.length;
    await page.send("Page.reload", { ignoreCache: true });
    await waitFor(async () => {
      const text = await page.text();
      return text.includes("Your cart is empty.") && !text.includes("Open an empty basket") && !text.includes("Loading your cart") ? text : "";
    }, 20000, "reloaded replacement");
    const reloadWrites = writes(cartTraffic(page, reloadFrom));
    const fresh = await page.responseFacts("GET", "/api/cart", 200, reloadFrom);
    if (!fresh?.id || fresh.leaked) throw new Error("replacement cart id was not readable");
    await helper.call("register", { cart_id: fresh.id });
    const oldState = await helper.call("verify", { cart_id: oldId });
    const newState = await helper.call("verify", { cart_id: fresh.id });
    const addFrom = page.traffic.length;
    await page.open(PRODUCT);
    await waitFor(async () => page.traffic.slice(addFrom).some((entry) => entry.method === "GET" && entry.path === "/api/cart" && entry.status === 200), 20000, "product basket read");
    await waitFor(async () => {
      const text = await page.text();
      return /add to cart/i.test(text) && !text.includes("Start a new basket") && !text.includes("Open an empty basket") ? text : "";
    }, 20000, "existing basket add");
    if (!(await page.clickLabel("Enhanced"))) throw new Error("Enhanced was not selected");
    if (!(await page.clickLabel("None"))) throw new Error("None was not selected");
    if (!(await page.clickButton("Add to Cart"))) throw new Error("Add was not clicked");
    await waitFor(async () => (await page.text()).includes("added to your cart"), 20000, "explicit add");
    await page.open(CART);
    const priced = await waitFor(async () => {
      const text = await page.text();
      return text.includes("Enhanced") && text.includes("£125.00") ? text : "";
    }, 15000, "replaced basket price");
    const addedCart = await page.responseFacts("GET", "/api/cart", 200);
    if (!addedCart?.optionIds?.includes("5") || !addedCart?.optionIds?.includes("6") || addedCart?.total !== "125.00") {
      throw new Error(`replacement add was not Enhanced and None at 125.00; options=${(addedCart?.optionIds || []).join(",") || "none"}; total=${addedCart?.total || "none"}`);
    }
    const adds = cartTraffic(page, addFrom).filter((entry) => entry.path === "/api/cart/add" && entry.status >= 200 && entry.status < 300);
    const addedState = await helper.call("verify", { cart_id: fresh.id });
    const sameSession = oldState.session_cart_id === fresh.id && addedState.session_cart_id === fresh.id;
    const ok = credentialSame
      && rejection?.code === "GUEST_CART_MISSING"
      && premature.length === 0
      && !beforeAction.some((entry) => entry.path === "/api/cart/reset" || entry.path === "/api/cart/create")
      && create?.status === 201
      && issuedCookie === false
      && reloadWrites.length === 0
      && oldState.cart_exists === false
      && oldState.token_unchanged === true
      && oldState.expires_unchanged === true
      && oldState.revoked === false
      && newState.item_count === 0
      && addedState.item_count === 1
      && addedState.token_unchanged === true
      && sameSession
      && fresh.id !== oldId
      && adds.length === 1
      && priced.includes("£125.00");
    record({
      id,
      status: ok ? "PASS" : "FAIL",
      detail: `fixture=delete_cart; read=${rejection?.status || "none"} ${rejection?.code || "none"}; credentialUnchanged=${credentialSame}; writesBeforeAction=${premature.length}; replace=${create?.status || "none"}; newCookie=${issuedCookie}; sameSession=${sameSession}; oldCartExists=${oldState.cart_exists}; tokenUnchanged=${oldState.token_unchanged}; expiryUnchanged=${oldState.expires_unchanged}; revoked=${oldState.revoked}; explicitAdds=${adds.length}; reloadWrites=${reloadWrites.length}`,
    });
  } catch (error) {
    let phrases = "unread";
    let traffic = "unread";
    if (page) {
      const text = await page.text().catch(() => "");
      phrases = ["added to your cart", "could not confirm", "not sent", "Choose an option", "Start a new basket", "Open an empty basket", "no longer available", "Adding"].filter((phrase) => text.includes(phrase)).join("|") || "none";
      traffic = cartTraffic(page).map((entry) => `${entry.method} ${entry.path} ${entry.status} ${entry.action || ""}`.trim()).join(" | ") || "none";
    }
    record({ id, status: "FAIL", detail: `${redact(error.message)}; phrases=${phrases}; traffic=${traffic}` });
  } finally {
    await browser.dispose(context);
  }
}

async function runLifecycle(browser) {
  const only = process.env.SCENARIO;
  const helper = startFixtureHelper();
  try {
    const begun = await helper.call("begin");
    console.log(`frontend ${commitOf(dirname(FRONTEND_ROOT))}`);
    console.log(`backend ${commitOf(BACKEND_ROOT)}`);
    console.log(`run ${begun.run_id}`);
    console.log(`backup ${begun.backup}`);
    const selected = only === "1" || only === "2" || only === "3" ? [only] : ["1", "2", "3"];
    if (selected.includes("1")) await scenarioCredentialLoss(browser, helper, "1", "expire");
    if (selected.includes("2")) await scenarioCredentialLoss(browser, helper, "2", "revoke");
    if (selected.includes("3")) await scenarioMissingCart(browser, helper);
    const totals = await helper.call("summary");
    console.log(`fixtures registered=${totals.registered}; carts_remaining=${totals.carts_remaining}; sessions_remaining=${totals.sessions_remaining}`);
  } catch (error) {
    record({ id: "lifecycle", status: "FAIL", detail: redact(error.message) });
  } finally {
    await helper.close();
  }
}

async function main() {
  const health = await fetch(`${ORIGIN}/api/health`);
  if (!health.ok) throw new Error("Nuxt is not reachable at localhost:3000");
  const django = await fetch("http://127.0.0.1:8000/api/products/");
  if (!django.ok) throw new Error("Django products API is not reachable");
  const browser = await launch();
  try {
    const version = await browser.version();
    console.log(`browser ${version}`);
    const only = process.env.SCENARIO;
    const lifecycle = process.env.GUEST_CART_LIFECYCLE === "1" || ["1", "2", "3", "lifecycle"].includes(only);
    if (lifecycle) {
      await runLifecycle(browser);
      return;
    }
    if (!only || only === "B") await scenarioBasket(browser);
    if (!only || only === "C") await scenarioTwoStarts(browser);
    if (!only || only === "D") await scenarioQuantity(browser);
    if (!only || only === "E") await scenarioResponseLoss(browser);
    if (!only || only === "F") await scenarioRateLimit(browser);
    if (!only || only === "G") await scenarioLocks(browser);
    if (!only || only === "H") {
      record({
        id: "H",
        status: "NOT RUN",
        detail: "Expiry, revocation and missing-cart checks stay opt-in. Run them with GUEST_CART_LIFECYCLE=1. This ordinary command does not change sessions.",
      });
    }
  } finally {
    await browser.close();
  }
  const failed = results.some((result) => result.status === "FAIL");
  if (failed) process.exitCode = 1;
}

const enteredDirectly = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (enteredDirectly) await main();
