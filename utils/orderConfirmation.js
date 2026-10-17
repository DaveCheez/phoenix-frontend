const REFERENCE = /^[A-Za-z0-9-]{4,32}$/;
const MONEY = /^[0-9]+\.[0-9]{2}$/;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const STORAGE_KEY = "phoenix-order-idempotency";
const DEPOSIT_TERMS = "One-third deposit. Balance due on completion of the work and fitting.";

const CUSTOMER_LIMITS = {
  customer_name: 200,
  customer_email: 254,
  customer_phone: 40,
  vehicle_make: 100,
  vehicle_model: 100,
  vehicle_wheelbase: 50,
  vehicle_registration: 20,
  customer_notes: 2000,
};

export function isOrderReference(value) {
  return typeof value === "string" && REFERENCE.test(value);
}

export function formatPounds(value) {
  if (typeof value !== "string" || !MONEY.test(value)) return null;
  return `£${value}`;
}

export function paymentExplanation(status) {
  if (status === "pending_deposit") {
    return {
      unpaid: true,
      heading: "Payment has not been taken",
      detail: "This order is unpaid and is waiting for Phoenix Vanz to confirm the next step.",
    };
  }
  return {
    unpaid: false,
    heading: "Payment status",
    detail: "Phoenix Vanz will confirm the payment position directly with you. No payment is taken on this page.",
  };
}

function text(value, maxLength, required) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (required && !cleaned) return null;
  if (cleaned.length > maxLength) return null;
  return cleaned;
}

export function validateCustomer(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Check the customer and vehicle details." };
  }
  const customer_name = text(input.customer_name, CUSTOMER_LIMITS.customer_name, true);
  const customer_email = text(input.customer_email, CUSTOMER_LIMITS.customer_email, true);
  const customer_phone = text(input.customer_phone, CUSTOMER_LIMITS.customer_phone, true);
  const vehicle_make = text(input.vehicle_make, CUSTOMER_LIMITS.vehicle_make, true);
  const vehicle_model = text(input.vehicle_model, CUSTOMER_LIMITS.vehicle_model, true);
  const vehicle_wheelbase = text(input.vehicle_wheelbase, CUSTOMER_LIMITS.vehicle_wheelbase, true);
  const vehicle_registration = text(input.vehicle_registration || "", CUSTOMER_LIMITS.vehicle_registration, false);
  const customer_notes = text(input.customer_notes || "", CUSTOMER_LIMITS.customer_notes, false);
  const year = Number(input.vehicle_year);
  const emailOk = typeof customer_email === "string" && /^[^\s@]+@[^\s@]+$/.test(customer_email);
  if (
    customer_name == null ||
    !emailOk ||
    customer_phone == null ||
    vehicle_make == null ||
    vehicle_model == null ||
    vehicle_wheelbase == null ||
    vehicle_registration == null ||
    customer_notes == null ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2100
  ) {
    return { ok: false, error: "Check the customer and vehicle details." };
  }
  const body = {
    customer_name,
    customer_email,
    customer_phone,
    vehicle_make,
    vehicle_model,
    vehicle_year: year,
    vehicle_wheelbase,
  };
  if (vehicle_registration) body.vehicle_registration = vehicle_registration;
  if (customer_notes) body.customer_notes = customer_notes;
  return { ok: true, body };
}

function payloadHash(body) {
  return JSON.stringify(body);
}

function readStored(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "");
    if (!parsed || typeof parsed.key !== "string" || !KEY.test(parsed.key) || typeof parsed.hash !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createIdempotencyKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function submissionKey(storage, body, { replace = false, createKey = createIdempotencyKey } = {}) {
  const hash = payloadHash(body);
  const current = readStored(storage);
  if (current && !replace) {
    if (current.hash === hash) return { action: "reuse", key: current.key };
    return { action: "conflict" };
  }
  const key = createKey();
  if (!KEY.test(key)) return { action: "conflict" };
  storage.setItem(STORAGE_KEY, JSON.stringify({ key, hash }));
  return { action: replace && current ? "replaced" : "created", key };
}

function optionView(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.group_name !== "string" || typeof value.option_name !== "string") return null;
  if (formatPounds(value.price_adjustment) == null) return null;
  return {
    groupName: value.group_name,
    optionName: value.option_name,
    priceAdjustment: value.price_adjustment,
  };
}

function itemView(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.product_name !== "string" || !value.product_name) return null;
  if (!Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 999) return null;
  if (formatPounds(value.configured_unit_price) == null || formatPounds(value.line_total) == null) return null;
  if (!Array.isArray(value.options)) return null;
  const options = value.options.map(optionView);
  if (options.some((option) => option == null)) return null;
  return {
    productName: value.product_name,
    quantity: value.quantity,
    configuredUnitPrice: value.configured_unit_price,
    lineTotal: value.line_total,
    options,
  };
}

export function publicOrderView(order) {
  if (!order || typeof order !== "object" || Array.isArray(order)) return null;
  if (!isOrderReference(order.reference)) return null;
  if (!Array.isArray(order.items) || order.items.length === 0) return null;
  const items = order.items.map(itemView);
  if (items.some((item) => item == null)) return null;
  for (const field of ["full_total", "deposit_required", "balance_on_completion", "fitting_charge", "tax_amount"]) {
    if (formatPounds(order[field]) == null) return null;
  }
  if (typeof order.customer_name !== "string" || typeof order.payment_status !== "string") return null;
  const created = typeof order.created_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(order.created_at)
    ? order.created_at.slice(0, 10)
    : "";
  return {
    reference: order.reference,
    createdOn: created,
    customerName: order.customer_name,
    vehicle: [order.vehicle_year, order.vehicle_make, order.vehicle_model, order.vehicle_wheelbase]
      .filter((part) => part != null && part !== "")
      .join(" "),
    currency: order.currency === "GBP" ? "GBP" : "",
    fullTotal: order.full_total,
    depositRequired: order.deposit_required,
    balanceOnCompletion: order.balance_on_completion,
    fittingCharge: order.fitting_charge,
    taxAmount: order.tax_amount,
    paymentStatus: order.payment_status,
    depositTerms: order.payment_terms_text === DEPOSIT_TERMS ? DEPOSIT_TERMS : "",
    items,
  };
}

export function confirmationRecord(view) {
  const lines = [
    `Phoenix Vanz order ${view.reference}`,
    view.createdOn ? `Created ${view.createdOn}` : "",
    paymentExplanation(view.paymentStatus).heading,
    paymentExplanation(view.paymentStatus).detail,
    `Total ${formatPounds(view.fullTotal)}`,
    `Deposit required later ${formatPounds(view.depositRequired)}`,
    `Balance on completion ${formatPounds(view.balanceOnCompletion)}`,
    ...view.items.map((item) => `${item.quantity} x ${item.productName} ${formatPounds(item.lineTotal)}`),
  ];
  return lines.filter(Boolean).join("\n");
}
