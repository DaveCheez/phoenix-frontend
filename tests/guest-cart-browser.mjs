// Local Edge acceptance checks for the guest cart. Fresh user-data directories only.
// Speaks to http://localhost:3000. Does not print cookies, CSRF, or guest tokens.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGIN = "http://localhost:3000";
const PRODUCT = `${ORIGIN}/product/guest-cart-integration-test`;
const CART = `${ORIGIN}/cart`;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const UNCERTAIN = "We could not confirm the latest basket update. Check your basket before trying the change again.";
const LAST_CONFIRMED = "Last confirmed basket — the latest change is not confirmed.";
const LOCKS_MESSAGE = "This browser cannot safely update the basket. Use a current browser, or contact Phoenix Vanz.";

const results = [];

function record(result) {
  results.push(result);
  console.log(`${result.id} ${result.status}${result.detail ? ` — ${result.detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs, label) {
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
    await rm(this.profile, { recursive: true, force: true });
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
      if (request.postData && request.postData.includes("quantity")) {
        try {
          quantity = JSON.parse(request.postData).quantity;
        } catch {
          quantity = undefined;
        }
      }
      this.requests.set(message.params.requestId, {
        at: Date.now(),
        method: request.method,
        path: new URL(request.url).pathname,
        quantity,
      });
      if (!this.sent) this.sent = [];
      this.sent.push({
        at: Date.now(),
        method: request.method,
        path: new URL(request.url).pathname,
        quantity,
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
}

function cookieNames(headers = {}) {
  const raw = headers["set-cookie"] || headers["Set-Cookie"] || "";
  return [...String(raw).matchAll(/(?:^|[\n,])\s*([A-Za-z0-9_-]+)=/g)].map((match) => match[1]);
}

async function launch() {
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

function isCreate(path) {
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
        detail: "No approved local fixture can revoke only this pass's guest credential or delete only its cart. An injected 401 was not used.",
      });
    }
  } finally {
    await browser.close();
  }
  const failed = results.some((result) => result.status === "FAIL");
  if (failed) process.exitCode = 1;
}

await main();
