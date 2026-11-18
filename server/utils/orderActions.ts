import type { H3Event } from "h3";
import { getQuery, getRequestHeader, readBody, setResponseStatus } from "h3";

import {
  cartFailure,
  guardFailure,
  type DjangoCall,
} from "./cartActions";
import type { CartConfig } from "./cartConfig";
import { cookieHeader, readGuestCookie } from "./cartCookies";
import { mutationGuards } from "./cartGuard";
import type { UpstreamResult } from "./cartTransport";

const CUSTOMER_FIELDS = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "vehicle_make",
  "vehicle_model",
  "vehicle_year",
  "vehicle_wheelbase",
  "vehicle_registration",
  "customer_notes",
] as const;

const ORDER_FIELDS = [...CUSTOMER_FIELDS, "cart_review_token"] as const;
const REVIEW_TOKEN = /^[0-9a-f]{64}$/;

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const REFERENCE = /^[A-Za-z0-9-]{4,32}$/;
const PAGE = /^[1-9][0-9]{0,3}$/;
const MONEY = /^[0-9]+\.[0-9]{2}$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SUMMARY_FIELDS = ["reference", "created_at", "currency", "full_total", "payment_status"] as const;
const LIST_FIELDS = ["success", "orders", "page", "has_more"] as const;

export function allowlistedOrder(body: Record<string, unknown> | null):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: string; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "ORDER_REQUEST_INVALID", error: "The order request is not valid." };
  }
  const keys = Object.keys(body);
  if (keys.some((key) => !ORDER_FIELDS.includes(key as typeof ORDER_FIELDS[number]))) {
    return { ok: false, code: "ORDER_REQUEST_INVALID", error: "The order request is not valid." };
  }
  const reviewToken = body.cart_review_token;
  if (typeof reviewToken !== "string" || !REVIEW_TOKEN.test(reviewToken)) {
    return { ok: false, code: "CART_REVIEW_REQUIRED", error: "Review the basket before placing the order." };
  }
  const required = CUSTOMER_FIELDS.slice(0, 7);
  if (required.some((key) => body[key] == null || body[key] === "")) {
    return { ok: false, code: "ORDER_REQUEST_INVALID", error: "The order request is not valid." };
  }
  if (typeof body.vehicle_year !== "number" || !Number.isInteger(body.vehicle_year)) {
    return { ok: false, code: "INVALID_VEHICLE", error: "The vehicle details are not valid." };
  }
  const cleaned: Record<string, unknown> = { cart_review_token: reviewToken };
  for (const key of CUSTOMER_FIELDS) {
    if (body[key] != null) cleaned[key] = body[key];
  }
  return { ok: true, body: cleaned };
}

function idempotencyKey(event: H3Event): string | null {
  const value = getRequestHeader(event, "idempotency-key");
  if (!value || !KEY.test(value)) return null;
  return value;
}

function orderResult(event: H3Event, result: UpstreamResult) {
  if (!result.ok) return cartFailure(event, result.status, result.code, result.error, result.retryAfter);
  const order = result.body.order;
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return cartFailure(event, 502, "ORDER_PROTOCOL_INCOMPATIBLE", "The order service returned an unexpected response.");
  }
  const record = order as Record<string, unknown>;
  if (typeof record.reference !== "string") {
    return cartFailure(event, 502, "ORDER_PROTOCOL_INCOMPATIBLE", "The order service returned an unexpected response.");
  }
  setResponseStatus(event, result.status);
  return { success: true, order: record };
}

export async function handleCreateOrder(event: H3Event, config: CartConfig, django: DjangoCall) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  if (guest.status !== "present") {
    return cartFailure(event, 401, "CART_SESSION_REQUIRED", "Start a basket before placing an order.");
  }
  if (!mutationGuards(event, config, "guest")) return guardFailure(event);
  const key = idempotencyKey(event);
  if (!key) {
    return cartFailure(event, 400, "IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.");
  }
  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  const allowed = allowlistedOrder(body);
  if (!allowed.ok) return cartFailure(event, 400, allowed.code, allowed.error);
  return orderResult(event, await django({
    path: "orders/",
    method: "POST",
    body: allowed.body,
    bearer: guest.value,
    idempotencyKey: key,
  }));
}

function publishedSummary(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !SUMMARY_FIELDS.includes(key as typeof SUMMARY_FIELDS[number]))) return null;
  if (typeof row.reference !== "string" || !REFERENCE.test(row.reference)) return null;
  if (typeof row.created_at !== "string" || !CREATED_AT.test(row.created_at)) return null;
  if (row.currency !== "GBP") return null;
  if (typeof row.full_total !== "string" || !MONEY.test(row.full_total)) return null;
  if (row.payment_status !== "pending_deposit") return null;
  return {
    reference: row.reference,
    created_at: row.created_at,
    currency: "GBP",
    full_total: row.full_total,
    payment_status: "pending_deposit",
  };
}

export function publishedOrderList(body: Record<string, unknown> | null, page: number) {
  if (!body || body.success !== true) return null;
  if (Object.keys(body).some((key) => !LIST_FIELDS.includes(key as typeof LIST_FIELDS[number]))) return null;
  if (body.page !== page || typeof body.has_more !== "boolean" || !Array.isArray(body.orders)) return null;
  if (body.orders.length > 20) return null;
  const orders = [];
  for (const row of body.orders) {
    const summary = publishedSummary(row);
    if (!summary) return null;
    orders.push(summary);
  }
  return { success: true, orders, page, has_more: body.has_more };
}

export async function handleOrderList(event: H3Event, config: CartConfig, django: DjangoCall) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  if (guest.status !== "present") {
    return cartFailure(event, 401, "CART_SESSION_REQUIRED", "A guest session is required before viewing orders.");
  }
  const requested = getQuery(event).page;
  if (typeof requested !== "string" || !PAGE.test(requested)) {
    return cartFailure(event, 400, "ORDER_REQUEST_INVALID", "The order request is not valid.");
  }
  const page = Number(requested);
  const result = await django({
    path: `orders/?page=${requested}`,
    method: "GET",
    bearer: guest.value,
  });
  if (!result.ok) return cartFailure(event, result.status, result.code, result.error, result.retryAfter);
  const published = publishedOrderList(result.body, page);
  if (!published) {
    return cartFailure(event, 502, "ORDER_PROTOCOL_INCOMPATIBLE", "The order service returned an unexpected response.");
  }
  setResponseStatus(event, 200);
  return published;
}

export async function handleOrderConfirmation(
  event: H3Event,
  config: CartConfig,
  django: DjangoCall,
  reference: string,
) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  if (guest.status !== "present") {
    return cartFailure(event, 401, "CART_SESSION_REQUIRED", "Start a basket before viewing an order.");
  }
  if (!REFERENCE.test(reference)) {
    return cartFailure(event, 404, "ORDER_NOT_AVAILABLE", "This order is not available.");
  }
  return orderResult(event, await django({
    path: `orders/${reference}/`,
    method: "GET",
    bearer: guest.value,
  }));
}
