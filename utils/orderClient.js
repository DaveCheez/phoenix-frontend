export const ORDER_ATTEMPT_STORAGE_KEY = "phoenix_order_attempt";

export const ORDER_MESSAGES = {
  missingFields: "The order request was not sent. Complete the highlighted details.",
  review: "The order request was not sent. Review the basket before placing the order.",
  empty: "The order request was not sent. Your basket is empty.",
  invalidBasket: "The order request was not sent. This basket cannot be ordered yet.",
  pending: "The order request was not sent. Wait until the basket update finishes.",
  unconfirmedBasket: "The order request was not sent. Confirm the basket before placing an order.",
  locks: "The order request was not sent. This browser cannot safely place the order.",
  csrf: "The order request was not sent. Try again.",
  cartChanged: "The basket has changed. Review it again before placing the order.",
  reviewRequired: "Review the basket before placing the order.",
  validation: "The order details were not accepted. Check the form and try again.",
  customer: "The customer details were not accepted. Check the form and try again.",
  vehicle: "The vehicle details were not accepted. Check the form and try again.",
  conflict: "This request conflicts with an earlier order attempt. Do not submit a different order.",
  uncertain: "The order request was sent, but the result is not confirmed. It may have been saved. Retry the same request.",
  blocked: "An earlier order request may have been saved, and its original details are no longer available in this browser. A new order cannot be submitted from this page.",
  resolved: "This order attempt is already complete. Place a different order only if you mean to.",
  unavailable: "This order is not available.",
  service: "The order could not be confirmed. Try again.",
  access: "Start a basket before placing an order.",
  year: "Enter a vehicle year from 1900 to 2100.",
  email: "Enter a valid email address.",
};

export const BASKET_BLOCK_MESSAGES = {
  pending: "A basket update is still in progress.",
  unconfirmed: "Confirm the basket before placing an order.",
  empty: "Your basket is empty. Add a product before submitting an order.",
  review: "Review the basket before placing the order.",
  invalid: "This basket cannot be ordered until every line has a confirmed price and a valid configuration.",
};

const MONEY = /^[0-9]+\.[0-9]{2}$/;
const REVIEW_TOKEN = /^[0-9a-f]{64}$/;
const REFERENCE = /^[A-Za-z0-9-]{4,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED_TEXT = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "vehicle_make",
  "vehicle_model",
  "vehicle_wheelbase",
];

const FIELD_MESSAGES = {
  customer_name: "Enter your name.",
  customer_email: ORDER_MESSAGES.email,
  customer_phone: "Enter a phone number.",
  vehicle_make: "Enter the vehicle make.",
  vehicle_model: "Enter the vehicle model.",
  vehicle_wheelbase: "Enter the wheelbase.",
  vehicle_year: ORDER_MESSAGES.year,
};

function moneyPence(value) {
  if (typeof value !== "string" || !MONEY.test(value)) return null;
  const [whole, fraction] = value.split(".");
  return Number(whole) * 100 + Number(fraction);
}

function copyText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateOrderRecord(order) {
  if (!order || typeof order !== "object" || Array.isArray(order)) return null;
  if (typeof order.reference !== "string" || !REFERENCE.test(order.reference)) return null;
  for (const field of ["customer_name", "customer_email", "customer_phone", "vehicle_make", "vehicle_model", "vehicle_wheelbase"]) {
    if (typeof order[field] !== "string" || !order[field].trim()) return null;
  }
  if (!Number.isInteger(order.vehicle_year) || order.vehicle_year < 1900 || order.vehicle_year > 2100) return null;
  if (order.vehicle_registration != null && typeof order.vehicle_registration !== "string") return null;
  if (order.customer_notes != null && typeof order.customer_notes !== "string") return null;
  if (order.payment_status !== "pending_deposit") return null;
  const full = moneyPence(order.full_total);
  const deposit = moneyPence(order.deposit_required);
  const balance = moneyPence(order.balance_on_completion);
  if (full == null || deposit == null || balance == null || deposit + balance !== full) return null;
  if (!Array.isArray(order.items) || order.items.length === 0) return null;
  const items = [];
  for (const item of order.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (typeof item.product_name !== "string" || !item.product_name.trim()) return null;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) return null;
    if (moneyPence(item.configured_unit_price) == null || moneyPence(item.line_total) == null) return null;
    if (!Array.isArray(item.options)) return null;
    const options = [];
    for (const option of item.options) {
      if (!option || typeof option !== "object" || Array.isArray(option)) return null;
      if (typeof option.group_name !== "string" || typeof option.option_name !== "string") return null;
      if (moneyPence(option.price_adjustment) == null) return null;
      options.push({
        group_name: option.group_name,
        option_name: option.option_name,
        price_adjustment: option.price_adjustment,
      });
    }
    const copy = {
      product_name: item.product_name,
      quantity: item.quantity,
      configured_unit_price: item.configured_unit_price,
      line_total: item.line_total,
      options,
    };
    if (typeof item.product_slug === "string") copy.product_slug = item.product_slug;
    items.push(copy);
  }
  return {
    reference: order.reference,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_phone: order.customer_phone,
    vehicle_make: order.vehicle_make,
    vehicle_model: order.vehicle_model,
    vehicle_year: order.vehicle_year,
    vehicle_wheelbase: order.vehicle_wheelbase,
    vehicle_registration: typeof order.vehicle_registration === "string" ? order.vehicle_registration : "",
    customer_notes: typeof order.customer_notes === "string" ? order.customer_notes : "",
    full_total: order.full_total,
    deposit_required: order.deposit_required,
    balance_on_completion: order.balance_on_completion,
    payment_status: order.payment_status,
    items,
  };
}

export function basketSubmissionBlock(state) {
  if (!state || state.pending) return "pending";
  if (state.access !== "ready" || !state.cart) return "unconfirmed";
  const cart = state.cart;
  if (!Array.isArray(cart.items) || cart.items.length === 0) return "empty";
  if (typeof cart.cart_review_token !== "string" || !REVIEW_TOKEN.test(cart.cart_review_token)) return "review";
  if (moneyPence(cart.total) == null) return "invalid";
  for (const item of cart.items) {
    if (!item || typeof item !== "object") return "invalid";
    if (item.configuration_valid === false) return "invalid";
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) return "invalid";
    const unit = item.configured_unit_price ?? item.price;
    if (moneyPence(item.line_total) == null || moneyPence(unit) == null) return "invalid";
    if (item.selected_options == null) continue;
    if (!Array.isArray(item.selected_options)) return "invalid";
    for (const option of item.selected_options) {
      if (!option || typeof option !== "object") return "invalid";
      if (typeof option.option_name !== "string" || typeof option.group_name !== "string") return "invalid";
      if (option.price_adjustment != null && option.price_adjustment !== "" && moneyPence(option.price_adjustment) == null) {
        return "invalid";
      }
    }
  }
  return null;
}

export function buildOrderBody(fields, reviewToken) {
  if (typeof reviewToken !== "string" || !REVIEW_TOKEN.test(reviewToken)) {
    return { ok: false, code: "review", message: ORDER_MESSAGES.review };
  }
  const body = { cart_review_token: reviewToken };
  for (const key of REQUIRED_TEXT) {
    const value = copyText(fields?.[key]);
    if (!value) {
      return { ok: false, code: "missing", field: key, message: FIELD_MESSAGES[key] || ORDER_MESSAGES.missingFields };
    }
    if (key === "customer_email" && !EMAIL.test(value)) {
      return { ok: false, code: "email", field: key, message: ORDER_MESSAGES.email };
    }
    body[key] = value;
  }
  const yearText = typeof fields?.vehicle_year === "number"
    ? String(fields.vehicle_year)
    : copyText(fields?.vehicle_year);
  if (!/^\d{4}$/.test(yearText)) {
    return { ok: false, code: "year", field: "vehicle_year", message: ORDER_MESSAGES.year };
  }
  const year = Number(yearText);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return { ok: false, code: "year", field: "vehicle_year", message: ORDER_MESSAGES.year };
  }
  body.vehicle_year = year;
  const registration = copyText(fields?.vehicle_registration);
  const notes = copyText(fields?.customer_notes);
  if (registration) body.vehicle_registration = registration;
  if (notes) body.customer_notes = notes;
  return { ok: true, body };
}

function readResult(value) {
  if (value instanceof Error) {
    const status = Number.isInteger(value.statusCode)
      ? value.statusCode
      : Number.isInteger(value.status) ? value.status : null;
    const data = value.data && typeof value.data === "object" && !Array.isArray(value.data) ? value.data : null;
    return { ok: false, status, data };
  }
  const status = Number.isInteger(value?.status) ? value.status : null;
  const raw = value?._data ?? value?.data;
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  return { ok: status != null && status >= 200 && status < 300, status, data };
}

function readMeta(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORDER_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.state === "unresolved" && Object.keys(parsed).length === 1) return { state: "unresolved" };
    if (
      parsed.state === "resolved"
      && typeof parsed.reference === "string"
      && REFERENCE.test(parsed.reference)
      && Object.keys(parsed).length === 2
    ) {
      return { state: "resolved", reference: parsed.reference };
    }
    return { state: "unresolved" };
  } catch {
    return { state: "unresolved" };
  }
}

function writeMeta(storage, meta) {
  if (!storage) return;
  try {
    if (!meta) {
      storage.removeItem(ORDER_ATTEMPT_STORAGE_KEY);
      return;
    }
    const payload = meta.state === "resolved"
      ? { state: "resolved", reference: meta.reference }
      : { state: "unresolved" };
    storage.setItem(ORDER_ATTEMPT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is a guard against a duplicate after reload, not a credential store.
  }
}

function createKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `order-${hex}`;
}

export function createOrderController(deps) {
  const storage = deps.storage;
  const meta = readMeta(storage);
  const memory = {
    phase: meta?.state === "resolved" ? "resolved" : meta?.state === "unresolved" ? "blocked" : "idle",
    key: null,
    body: null,
    reference: meta?.state === "resolved" ? meta.reference : null,
  };
  let busy = false;
  let csrfToken = "";

  function clearAttempt() {
    memory.phase = "idle";
    memory.key = null;
    memory.body = null;
    writeMeta(storage, null);
  }

  function blockedResult() {
    return { outcome: "blocked", message: ORDER_MESSAGES.blocked, sent: false };
  }

  function preparation(code, extra = {}) {
    const message = extra.message || ORDER_MESSAGES[code] || BASKET_BLOCK_MESSAGES[code] || ORDER_MESSAGES.missingFields;
    return { outcome: "preparation", code, message, sent: false, field: extra.field };
  }

  async function fetchCsrf() {
    let result;
    try {
      result = readResult(await deps.fetch("/api/cart/csrf", {
        method: "GET",
        retry: 0,
        headers: { accept: "application/json", "x-phoenix-csrf-request": "1" },
      }));
    } catch (error) {
      result = readResult(error);
    }
    if (!result.ok || typeof result.data?.csrf_token !== "string" || !result.data.csrf_token) {
      csrfToken = "";
      return false;
    }
    csrfToken = result.data.csrf_token;
    return true;
  }

  function classify(result) {
    const code = typeof result.data?.code === "string" ? result.data.code : "";
    if (result.ok && (result.status === 200 || result.status === 201) && result.data?.success === true) {
      const order = validateOrderRecord(result.data.order);
      if (!order) {
        memory.phase = "uncertain";
        writeMeta(storage, { state: "unresolved" });
        return { outcome: "uncertain", message: ORDER_MESSAGES.uncertain, sent: true };
      }
      memory.phase = "resolved";
      memory.key = null;
      memory.body = null;
      memory.reference = order.reference;
      writeMeta(storage, { state: "resolved", reference: order.reference });
      return { outcome: "success", order, sent: true, message: "" };
    }
    if (result.status != null && result.status >= 400 && result.status < 500) {
      if (code === "CART_CHANGED") {
        clearAttempt();
        return { outcome: "cart_changed", code, message: ORDER_MESSAGES.cartChanged, sent: true, refresh: true };
      }
      if (code === "CART_REVIEW_REQUIRED") {
        clearAttempt();
        return { outcome: "review_required", code, message: ORDER_MESSAGES.reviewRequired, sent: true, refresh: true };
      }
      if (code === "IDEMPOTENCY_CONFLICT") {
        memory.phase = "conflict";
        writeMeta(storage, { state: "unresolved" });
        return { outcome: "conflict", code, message: ORDER_MESSAGES.conflict, sent: true };
      }
      if (code === "INVALID_CUSTOMER" || code === "INVALID_VEHICLE" || code === "ORDER_REQUEST_INVALID" || code === "EMPTY_CART") {
        clearAttempt();
        const message = code === "INVALID_CUSTOMER"
          ? ORDER_MESSAGES.customer
          : code === "INVALID_VEHICLE"
            ? ORDER_MESSAGES.vehicle
            : code === "EMPTY_CART"
              ? ORDER_MESSAGES.empty
              : ORDER_MESSAGES.validation;
        return {
          outcome: "validation",
          code,
          message,
          sent: true,
          refresh: code === "EMPTY_CART",
        };
      }
      if (code === "CART_SESSION_REQUIRED" || code === "CART_ACCESS_UNAVAILABLE" || code === "ORDER_NOT_AVAILABLE") {
        clearAttempt();
        return { outcome: "access", code, message: ORDER_MESSAGES.access, sent: true };
      }
    }
    memory.phase = "uncertain";
    writeMeta(storage, { state: "unresolved" });
    return { outcome: "uncertain", message: ORDER_MESSAGES.uncertain, sent: true };
  }

  async function dispatch(key, body) {
    if (!(await fetchCsrf())) return preparation("csrf");
    memory.key = key;
    memory.body = body;
    memory.phase = "uncertain";
    writeMeta(storage, { state: "unresolved" });
    let result;
    try {
      result = readResult(await deps.fetch("/api/orders", {
        method: "POST",
        retry: 0,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-phoenix-csrf": csrfToken,
          "idempotency-key": key,
        },
        body,
      }));
    } catch (error) {
      result = readResult(error);
    }
    return classify(result);
  }

  async function runLocked(task) {
    let result;
    try {
      result = await deps.lock(task);
    } catch {
      return preparation("locks");
    }
    if (result?.refresh) {
      try {
        await deps.refreshBasket();
      } catch {
        // The basket client records its own unconfirmed state.
      }
    }
    return result;
  }

  function refuseCurrentPhase() {
    if (busy) return { outcome: "duplicate", message: "", sent: false };
    if (memory.phase === "uncertain") return { outcome: "uncertain", message: ORDER_MESSAGES.uncertain, sent: false };
    if (memory.phase === "conflict") return { outcome: "conflict", message: ORDER_MESSAGES.conflict, sent: false };
    if (memory.phase === "blocked") return blockedResult();
    if (memory.phase === "resolved") return { outcome: "resolved", message: ORDER_MESSAGES.resolved, sent: false };
    return null;
  }

  async function submit(fields) {
    const refused = refuseCurrentPhase();
    if (refused) return refused;
    if (!deps.locksAvailable()) return preparation("locks");
    busy = true;
    try {
      return await runLocked(async () => {
        const block = basketSubmissionBlock(deps.cartState());
        if (block) return preparation(block);
        const built = buildOrderBody(fields, deps.cartState().cart.cart_review_token);
        if (!built.ok) return preparation(built.code, built);
        const key = (deps.createKey || createKey)();
        return dispatch(key, built.body);
      });
    } finally {
      busy = false;
    }
  }

  async function retry() {
    if (busy) return { outcome: "duplicate", message: "", sent: false };
    if (memory.phase !== "uncertain" || !memory.key || !memory.body) return blockedResult();
    if (!deps.locksAvailable()) return preparation("locks");
    const key = memory.key;
    const body = memory.body;
    busy = true;
    try {
      return await runLocked(() => dispatch(key, body));
    } finally {
      busy = false;
    }
  }

  function startNewOrder() {
    if (memory.phase !== "resolved") return false;
    memory.phase = "idle";
    memory.reference = null;
    memory.key = null;
    memory.body = null;
    writeMeta(storage, null);
    return true;
  }

  function status() {
    return { phase: memory.phase, reference: memory.reference };
  }

  return { submit, retry, startNewOrder, status };
}

export async function readOrderConfirmation(fetchImpl, reference) {
  if (typeof reference !== "string" || !REFERENCE.test(reference)) {
    return { outcome: "unavailable", message: ORDER_MESSAGES.unavailable };
  }
  let result;
  try {
    result = readResult(await fetchImpl(`/api/orders/${encodeURIComponent(reference)}`, {
      method: "GET",
      retry: 0,
      headers: { accept: "application/json" },
    }));
  } catch (error) {
    result = readResult(error);
  }
  if (result.ok && result.status === 200 && result.data?.success === true) {
    const order = validateOrderRecord(result.data.order);
    if (!order || order.reference !== reference) {
      return { outcome: "service", message: ORDER_MESSAGES.service };
    }
    return { outcome: "success", order };
  }
  if (result.status === 401 || result.status === 404) {
    return { outcome: "unavailable", message: ORDER_MESSAGES.unavailable };
  }
  return { outcome: "service", message: ORDER_MESSAGES.service };
}
