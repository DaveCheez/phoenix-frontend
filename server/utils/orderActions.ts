import type { H3Event } from "h3";
import { getRequestHeader, readBody, setResponseStatus } from "h3";

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

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const REFERENCE = /^[A-Za-z0-9-]{4,32}$/;

export function allowlistedOrder(body: Record<string, unknown> | null):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: string; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "ORDER_REQUEST_INVALID", error: "The order request is not valid." };
  }
  const keys = Object.keys(body);
  if (keys.some((key) => !CUSTOMER_FIELDS.includes(key as typeof CUSTOMER_FIELDS[number]))) {
    return { ok: false, code: "ORDER_REQUEST_INVALID", error: "The order request is not valid." };
  }
  const required = CUSTOMER_FIELDS.slice(0, 7);
  if (required.some((key) => body[key] == null || body[key] === "")) {
    return { ok: false, code: "ORDER_REQUEST_INVALID", error: "The order request is not valid." };
  }
  if (typeof body.vehicle_year !== "number" || !Number.isInteger(body.vehicle_year)) {
    return { ok: false, code: "INVALID_VEHICLE", error: "The vehicle details are not valid." };
  }
  const cleaned: Record<string, unknown> = {};
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
