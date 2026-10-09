export const UNCONFIRMED_MESSAGE =
  "We could not confirm the latest basket update. Check your basket before trying the change again.";

export const LAST_CONFIRMED_LABEL =
  "Last confirmed basket — the latest change is not confirmed.";

export const LINE_MISSING_MESSAGE = "This item is no longer in your basket.";

export const PREFLIGHT_MESSAGE = "The basket change was not sent. Try again.";

const MONEY = /^[0-9]+\.[0-9]{2}$/;
const CART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALIDATION_CODES = new Set([
  "MISSING_FIELDS",
  "INVALID_OPTIONS_FORMAT",
  "INVALID_OPTION",
  "DUPLICATE_OPTION",
  "DUPLICATE_GROUP_SELECTION",
  "MISSING_REQUIRED_OPTION",
  "UNEXPECTED_PRICE_FIELD",
  "CONFIGURATION_CONFLICT",
  "INVALID_QUANTITY",
]);

const SESSION_CODES = new Set([
  "CART_SESSION_REQUIRED",
  "CART_ACCESS_UNAVAILABLE",
  "GUEST_CART_MISSING",
]);

const SAFE_LOG_CODES = new Set([
  ...VALIDATION_CODES,
  ...SESSION_CODES,
  "CART_PROTOCOL_INCOMPATIBLE",
  "CART_SERVICE_UNAVAILABLE",
  "CART_TEMPORARILY_UNAVAILABLE",
  "CART_SERVICE_CONFIGURATION",
  "CART_REQUEST_REJECTED",
  "CART_PREFLIGHT",
  "CART_NOT_READY",
  "CART_LINE_MISSING",
  "CART_STALE",
  "CART_LOCKS_UNAVAILABLE",
  "CART_UNKNOWN",
  "OK",
]);

const VALIDATION_MESSAGES = {
  INVALID_QUANTITY: "Quantity must be a whole number from 0 to 999.",
  MISSING_REQUIRED_OPTION: "Choose an option for every required group before adding this product.",
  INVALID_OPTIONS_FORMAT: "Choose a valid option for this product.",
  INVALID_OPTION: "Choose a valid option for this product.",
  DUPLICATE_OPTION: "Choose each option only once.",
  DUPLICATE_GROUP_SELECTION: "Choose one option for each group.",
  MISSING_FIELDS: "The product could not be added. Check the selection and try again.",
  UNEXPECTED_PRICE_FIELD: "The basket change was not accepted.",
  CONFIGURATION_CONFLICT: "This product configuration could not be added. Choose the options again.",
};

let logSink = () => {};

export function setCartClientLog(sink) {
  logSink = typeof sink === "function" ? sink : () => {};
}

export function logCartClient(operation, code, status) {
  const safeOperation = operation === "cart-read" || operation === "cart-add" || operation === "cart-update" || operation === "cart-remove" || operation === "cart-clear" || operation === "cart-refresh" || operation === "cart-start" || operation === "cart-replace"
    ? operation
    : "cart-update";
  const safeCode = SAFE_LOG_CODES.has(code) ? code : "CART_UNKNOWN";
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? ` ${status}` : "";
  logSink(`cart ${safeOperation} ${safeCode}${safeStatus}`);
}

export function logCartFailure(operation, error) {
  logCartClient(operation, error?.cartCode, error?.cartStatus);
}

export function customerMessage(outcome, code) {
  if (outcome === "uncertain") return UNCONFIRMED_MESSAGE;
  if (outcome === "absent_line") return LINE_MISSING_MESSAGE;
  if (outcome === "preflight") return PREFLIGHT_MESSAGE;
  if (outcome === "validation") {
    return VALIDATION_MESSAGES[code] || "The basket change was not accepted. Check the selection and try again.";
  }
  if (outcome === "access_unavailable" || outcome === "legacy") {
    return "We cannot reopen your previous basket. Start a new empty basket to continue.";
  }
  if (outcome === "missing_cart") {
    return "Your basket is no longer available. You can open a new empty basket.";
  }
  if (outcome === "locks_unavailable") {
    return "This browser cannot safely update the basket. Use a current browser, or contact Phoenix Vanz.";
  }
  if (outcome === "session_required") return "Start a basket before changing it.";
  return UNCONFIRMED_MESSAGE;
}

export class CartClientError extends Error {
  constructor(outcome, code, status) {
    const message = customerMessage(outcome, code);
    super(message);
    this.name = "CartClientError";
    this.cartOutcome = outcome;
    this.cartCode = SAFE_LOG_CODES.has(code) ? code : "CART_UNKNOWN";
    this.cartStatus = Number.isInteger(status) ? status : undefined;
    this.customerMessage = message;
  }
}

function moneyOrOmit(value, required) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string" || !MONEY.test(value)) return null;
  return value;
}

function validateItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const itemId = value.item_id;
  const idOk = (Number.isInteger(itemId) && itemId > 0) || (typeof itemId === "string" && itemId.length > 0);
  if (!idOk) return null;
  if (!Number.isInteger(value.quantity) || value.quantity < 0 || value.quantity > 999) return null;
  if (typeof value.name !== "string") return null;
  const item = { item_id: itemId, quantity: value.quantity, name: value.name };
  if (value.product_slug != null) {
    if (typeof value.product_slug !== "string") return null;
    item.product_slug = value.product_slug;
  }
  if (value.product_id != null) {
    if (!Number.isInteger(value.product_id) || value.product_id <= 0) return null;
    item.product_id = value.product_id;
  }
  if (value.sku != null) {
    if (typeof value.sku !== "string") return null;
    item.sku = value.sku;
  }
  if (value.image != null) {
    if (typeof value.image !== "string") return null;
    item.image = value.image;
  }
  if (typeof value.configuration_valid === "boolean") {
    item.configuration_valid = value.configuration_valid;
  }
  for (const field of ["base_unit_price", "options_total", "configured_unit_price", "price", "line_total"]) {
    if (value[field] == null || value[field] === "") continue;
    const money = moneyOrOmit(value[field], true);
    if (money == null) return null;
    item[field] = money;
  }
  if (value.selected_options != null) {
    if (!Array.isArray(value.selected_options)) return null;
    item.selected_options = [];
    for (const option of value.selected_options) {
      if (!option || typeof option !== "object" || Array.isArray(option)) return null;
      const copy = {};
      for (const key of ["group_id", "group_name", "option_id", "option_name", "price_adjustment"]) {
        if (option[key] != null) copy[key] = option[key];
      }
      if (copy.price_adjustment != null && copy.price_adjustment !== "") {
        const money = moneyOrOmit(copy.price_adjustment, true);
        if (money == null) return null;
        copy.price_adjustment = money;
      }
      item.selected_options.push(copy);
    }
  }
  return item;
}

export function validateCartPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.id !== "string" || !CART_ID.test(value.id)) return null;
  if (!Array.isArray(value.items)) return null;
  if (!Number.isInteger(value.item_count) || value.item_count < 0) return null;
  const total = moneyOrOmit(value.total, true);
  if (total == null) return null;
  const items = [];
  for (const entry of value.items) {
    const item = validateItem(entry);
    if (!item) return null;
    items.push(item);
  }
  return { id: value.id, items, item_count: value.item_count, total };
}

function plainData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function numericStatus(error) {
  const candidates = [error?.statusCode, error?.status, error?.response?.status];
  for (const candidate of candidates) {
    if (Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) return candidate;
  }
  return null;
}

export function normaliseTransport(resultOrError, dispatched) {
  if (resultOrError && typeof resultOrError === "object" && "dispatched" in resultOrError && "ok" in resultOrError) {
    return resultOrError;
  }
  if (resultOrError instanceof Error || (resultOrError && resultOrError.name && !("status" in resultOrError) && !("_data" in resultOrError))) {
    const status = numericStatus(resultOrError);
    return {
      ok: false,
      status,
      data: plainData(resultOrError.data) || plainData(resultOrError.response?._data),
      dispatched: dispatched || status != null,
    };
  }
  const status = numericStatus(resultOrError) ?? (Number.isInteger(resultOrError?.status) ? resultOrError.status : null);
  const data = plainData(resultOrError?._data) || plainData(resultOrError?.data);
  const ok = status != null && status >= 200 && status < 300;
  return { ok, status, data, dispatched: true };
}

export function classifyTransport(result) {
  const status = result?.status ?? null;
  const data = plainData(result?.data);
  const code = typeof data?.code === "string" ? data.code : "";
  if (status === 429 || (status != null && status >= 500)) {
    const uncertainCode = code === "CART_TEMPORARILY_UNAVAILABLE" || code === "CART_SERVICE_CONFIGURATION"
      ? code
      : "CART_SERVICE_UNAVAILABLE";
    return { outcome: "uncertain", code: uncertainCode, status };
  }
  if (code === "CART_SESSION_REQUIRED") return { outcome: "session_required", code, status };
  if (code === "GUEST_CART_MISSING") return { outcome: "missing_cart", code, status };
  if (code === "CART_ACCESS_UNAVAILABLE") return { outcome: "access_unavailable", code, status };
  if (VALIDATION_CODES.has(code) && status != null && status >= 400 && status < 500) {
    return { outcome: "validation", code, status };
  }
  if (code === "CART_REQUEST_REJECTED" && status === 403) {
    return { outcome: "preflight", code, status };
  }
  if (result?.ok && status != null && status >= 200 && status < 300) {
    if (data?.success !== true) return { outcome: "uncertain", code: "CART_PROTOCOL_INCOMPATIBLE", status };
    const cart = validateCartPayload(data.cart);
    if (!cart) return { outcome: "uncertain", code: "CART_PROTOCOL_INCOMPATIBLE", status };
    return { outcome: "success", code: "OK", status, cart };
  }
  if (!result?.dispatched && status == null) {
    return { outcome: "preflight", code: "CART_PREFLIGHT", status };
  }
  let uncertainCode = "CART_SERVICE_UNAVAILABLE";
  if (code === "CART_PROTOCOL_INCOMPATIBLE" || code === "CART_TEMPORARILY_UNAVAILABLE" || code === "CART_SERVICE_CONFIGURATION") {
    uncertainCode = code;
  }
  return { outcome: "uncertain", code: uncertainCode, status };
}

function csrfHeaders(token) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-phoenix-csrf": token,
  };
}

export function createCartController(deps) {
  const state = deps.state;
  let generation = 0;
  let csrfToken = "";
  let queue = Promise.resolve();

  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  const schedule = deps.schedule || enqueue;

  async function transport(path, options = {}) {
    try {
      const response = await deps.fetch(path, { ...options, retry: 0 });
      return normaliseTransport(response, true);
    } catch (error) {
      return normaliseTransport(error, true);
    }
  }

  function applySession(decision, legacyMarker) {
    if (decision.outcome === "session_required") {
      state.cart = null;
      state.access = legacyMarker || deps.legacyPresent?.() ? "legacy" : "not_started";
      return;
    }
    if (decision.outcome === "missing_cart") {
      state.cart = null;
      state.access = "missing_cart";
      return;
    }
    if (decision.outcome === "access_unavailable") {
      state.cart = null;
      state.access = "access_unavailable";
    }
  }

  function applySuccess(cart) {
    state.cart = cart;
    state.access = "ready";
  }

  function markUnconfirmed() {
    state.access = "temporary";
  }

  async function readBasket(operation) {
    const seen = generation;
    const result = await transport("/api/cart");
    if (seen !== generation) return { stale: true };
    const decision = classifyTransport(result);
    logCartClient(operation, decision.code, decision.status);
    if (decision.outcome === "success") {
      applySuccess(decision.cart);
      return decision;
    }
    if (decision.outcome === "session_required" || decision.outcome === "missing_cart" || decision.outcome === "access_unavailable") {
      applySession(decision, result.data?.legacy_marker);
      return decision;
    }
    markUnconfirmed();
    return { ...decision, outcome: "uncertain" };
  }

  async function fetchCsrf() {
    const result = await transport("/api/cart/csrf", {
      headers: { accept: "application/json", "x-phoenix-csrf-request": "1" },
    });
    if (!result.ok || result.status == null || typeof result.data?.csrf_token !== "string") {
      csrfToken = "";
      return false;
    }
    csrfToken = result.data.csrf_token;
    return true;
  }

  async function writeUnlocked(path, options, operation) {
    if (!(await fetchCsrf())) {
      logCartClient(operation, "CART_PREFLIGHT");
      throw new CartClientError("preflight", "CART_PREFLIGHT");
    }
    const result = await transport(path, {
      ...options,
      headers: { ...csrfHeaders(csrfToken), ...(options.headers || {}) },
    });
    const decision = classifyTransport(result);
    logCartClient(operation, decision.code, decision.status);
    if (decision.outcome === "success") {
      applySuccess(decision.cart);
      return { ok: true, broadcast: true, cart: decision.cart };
    }
    if (decision.outcome === "validation") {
      throw new CartClientError("validation", decision.code, decision.status);
    }
    if (decision.outcome === "preflight") {
      throw new CartClientError("preflight", decision.code, decision.status);
    }
    if (decision.outcome === "session_required" || decision.outcome === "missing_cart" || decision.outcome === "access_unavailable") {
      applySession(decision, result.data?.legacy_marker);
      throw new CartClientError(decision.outcome === "session_required" ? "session_required" : decision.outcome, decision.code, decision.status);
    }
    markUnconfirmed();
    throw new CartClientError("uncertain", decision.code, decision.status);
  }

  async function run(task, { lockRequired, broadcast }) {
    state.pending = true;
    try {
      const execute = async () => {
        if (lockRequired && !deps.locksAvailable()) {
          state.access = "locks_unavailable";
          throw new CartClientError("preflight", "CART_LOCKS_UNAVAILABLE");
        }
        if (lockRequired) return deps.lock(task);
        return task();
      };
      const result = await schedule(execute);
      if (broadcast && result?.broadcast) deps.notify?.();
      return result;
    } finally {
      state.pending = false;
    }
  }

  function requireReady() {
    if (state.access !== "ready") {
      throw new CartClientError("preflight", "CART_NOT_READY");
    }
  }

  async function loadCart() {
    deps.ensureChannel?.();
    return run(() => readBasket("cart-read"), { lockRequired: deps.locksAvailable() });
  }

  async function refreshBasket() {
    return run(() => readBasket("cart-refresh"), { lockRequired: deps.locksAvailable() });
  }

  async function addToCart(productId, quantity = 1, options = []) {
    return run(async () => {
      requireReady();
      generation += 1;
      return writeUnlocked("/api/cart/add", {
        method: "POST",
        body: {
          product_id: productId,
          quantity,
          options: Array.isArray(options) ? options : [],
        },
      }, "cart-add");
    }, { lockRequired: true, broadcast: true });
  }

  async function setQuantity(itemId, quantity) {
    return run(async () => {
      requireReady();
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
        throw new CartClientError("validation", "INVALID_QUANTITY");
      }
      generation += 1;
      return writeUnlocked("/api/cart/update", {
        method: "POST",
        body: { item_id: itemId, quantity },
      }, "cart-update");
    }, { lockRequired: true, broadcast: true });
  }

  async function adjustQuantity(itemId, delta) {
    return run(async () => {
      requireReady();
      if (delta !== 1 && delta !== -1) {
        throw new CartClientError("validation", "INVALID_QUANTITY");
      }
      generation += 1;
      const read = await readBasket("cart-read");
      if (read?.stale) throw new CartClientError("preflight", "CART_STALE");
      if (read?.outcome !== "success" && state.access !== "ready") {
        throw new CartClientError(
          state.access === "temporary" ? "uncertain" : state.access,
          read?.code || "CART_SERVICE_UNAVAILABLE",
          read?.status,
        );
      }
      if (state.access !== "ready" || !state.cart) {
        throw new CartClientError("uncertain", read?.code || "CART_SERVICE_UNAVAILABLE", read?.status);
      }
      const line = state.cart.items.find((item) => item.item_id === itemId);
      if (!line) throw new CartClientError("absent_line", "CART_LINE_MISSING");
      const quantity = line.quantity + delta;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
        throw new CartClientError("validation", "INVALID_QUANTITY");
      }
      return writeUnlocked("/api/cart/update", {
        method: "POST",
        body: { item_id: itemId, quantity },
      }, "cart-update");
    }, { lockRequired: true, broadcast: true });
  }

  async function removeItem(itemId) {
    return run(async () => {
      requireReady();
      generation += 1;
      return writeUnlocked("/api/cart/remove", {
        method: "POST",
        body: { item_id: itemId },
      }, "cart-remove");
    }, { lockRequired: true, broadcast: true });
  }

  async function clearCart() {
    return run(async () => {
      requireReady();
      generation += 1;
      return writeUnlocked("/api/cart/clear", {
        method: "DELETE",
        body: {},
      }, "cart-clear");
    }, { lockRequired: true, broadcast: true });
  }

  async function startNewBasket() {
    return run(async () => {
      if (state.access === "access_unavailable" || state.access === "legacy") {
        const reset = await resetUnlocked();
        if (!reset) return;
      }
      if (!(await fetchCsrf())) throw new CartClientError("preflight", "CART_PREFLIGHT");
      generation += 1;
      const seen = generation;
      const result = await transport("/api/cart/create", {
        method: "POST",
        body: { action: "start" },
        headers: csrfHeaders(csrfToken),
      });
      if (seen !== generation) return { stale: true };
      const decision = classifyTransport(result);
      logCartClient("cart-start", decision.code, decision.status);
      if (decision.outcome !== "success") {
        if (decision.outcome === "uncertain") markUnconfirmed();
        else applySession(decision, result.data?.legacy_marker);
        throw new CartClientError(decision.outcome === "success" ? "uncertain" : decision.outcome, decision.code, decision.status);
      }
      generation += 1;
      csrfToken = "";
      deps.retireLegacy?.();
      applySuccess(decision.cart);
      return { ok: true, broadcast: true, cart: decision.cart };
    }, { lockRequired: true, broadcast: true });
  }

  async function resetUnlocked() {
    if (!(await fetchCsrf())) return false;
    const seen = generation;
    const result = await transport("/api/cart/reset", {
      method: "POST",
      body: { confirm: true },
      headers: csrfHeaders(csrfToken),
    });
    if (seen !== generation) return false;
    if (result.data?.code === "CART_STILL_AVAILABLE") {
      const cart = validateCartPayload(result.data.cart);
      if (cart && result.data.success === false) {
        applySuccess(cart);
        return false;
      }
    }
    if (result.data?.code === "GUEST_CART_MISSING") {
      state.cart = null;
      state.access = "missing_cart";
      return false;
    }
    if (!result.ok || result.data?.code !== "CART_SESSION_RESET") {
      const decision = classifyTransport(result);
      if (decision.outcome === "uncertain") markUnconfirmed();
      return false;
    }
    generation += 1;
    csrfToken = "";
    state.cart = null;
    state.access = "not_started";
    return true;
  }

  async function openEmptyBasket() {
    return run(async () => {
      if (!(await fetchCsrf())) throw new CartClientError("preflight", "CART_PREFLIGHT");
      generation += 1;
      const seen = generation;
      const result = await transport("/api/cart/create", {
        method: "POST",
        body: { action: "replace_missing" },
        headers: csrfHeaders(csrfToken),
      });
      if (seen !== generation) return { stale: true };
      const decision = classifyTransport(result);
      logCartClient("cart-replace", decision.code, decision.status);
      if (decision.outcome !== "success") {
        if (decision.outcome === "uncertain") markUnconfirmed();
        else applySession(decision, false);
        throw new CartClientError(decision.outcome, decision.code, decision.status);
      }
      generation += 1;
      csrfToken = "";
      applySuccess(decision.cart);
      return { ok: true, broadcast: true, cart: decision.cart };
    }, { lockRequired: true, broadcast: true });
  }

  function recoverBasket() {
    if (state.access === "temporary") return refreshBasket();
    if (state.access === "missing_cart") return openEmptyBasket();
    return startNewBasket();
  }

  return {
    state,
    loadCart,
    refreshBasket,
    addToCart,
    setQuantity,
    adjustQuantity,
    removeItem,
    clearCart,
    startNewBasket,
    openEmptyBasket,
    recoverBasket,
  };
}
