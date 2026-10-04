import type { H3Event } from "h3";
import { getRequestHeader } from "h3";

import type { CartConfig } from "./cartConfig";
import type { CsrfContext } from "./cartCsrf";
import { verifyCsrfToken } from "./cartCsrf";
import {
  cookieHeader,
  readBootstrapCookie,
  readGuestCookie,
} from "./cartCookies";

export function headerValues(event: H3Event, name: string): string[] {
  const raw = event.node?.req?.rawHeaders || [];
  const values: string[] = [];
  for (let index = 0; index < raw.length; index += 2) {
    if (String(raw[index]).toLowerCase() === name.toLowerCase()) {
      values.push(String(raw[index + 1]));
    }
  }
  return values;
}

export function requestHost(event: H3Event): string {
  const hosts = headerValues(event, "host");
  if (hosts.length !== 1) return "";
  return hosts[0].trim().toLowerCase();
}

export function hostAllowed(event: H3Event, config: CartConfig): boolean {
  return requestHost(event) === config.host.toLowerCase();
}

function refererOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function csrfReadAllowed(event: H3Event, config: CartConfig): boolean {
  if (getRequestHeader(event, "x-phoenix-csrf-request") !== "1") return false;
  if (!hostAllowed(event, config)) return false;

  const siteValues = headerValues(event, "sec-fetch-site");
  if (siteValues.length > 1) return false;
  if (siteValues.length === 1) {
    return siteValues[0].trim().toLowerCase() === "same-origin";
  }

  const origins = headerValues(event, "origin");
  const referers = headerValues(event, "referer");
  if (origins.length > 1 || referers.length > 1) return false;
  const origin = origins[0];
  const referer = refererOrigin(referers[0]);
  return origin === config.origin || referer === config.origin;
}

export function mutationOriginAllowed(event: H3Event, config: CartConfig): boolean {
  if (!hostAllowed(event, config)) return false;
  const origins = headerValues(event, "origin");
  if (origins.length !== 1) return false;
  const origin = origins[0].trim();
  if (!origin || origin === "null") return false;
  return origin === config.origin;
}

export function jsonContentType(event: H3Event): boolean {
  const values = headerValues(event, "content-type");
  if (values.length !== 1) return false;
  const type = values[0].split(";")[0].trim().toLowerCase();
  return type === "application/json";
}

export function csrfBinding(
  event: H3Event,
  config: CartConfig,
  context: CsrfContext,
): string | null {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  if (context === "guest") {
    return guest.status === "present" ? guest.value : null;
  }
  if (guest.status === "present") return null;
  const bootstrap = readBootstrapCookie(cookieHeader(event), config.dev);
  return bootstrap.status === "present" ? bootstrap.value : null;
}

export function csrfTokenAllowed(
  event: H3Event,
  config: CartConfig,
  expected: CsrfContext,
): boolean {
  const binding = csrfBinding(event, config, expected);
  if (!binding) return false;
  const tokens = headerValues(event, "x-phoenix-csrf");
  if (tokens.length !== 1) return false;
  return verifyCsrfToken({
    secret: config.secret,
    token: tokens[0].trim(),
    context: expected,
    binding,
  });
}

export function mutationGuards(
  event: H3Event,
  config: CartConfig,
  expected: CsrfContext,
): boolean {
  return (
    mutationOriginAllowed(event, config) &&
    jsonContentType(event) &&
    csrfTokenAllowed(event, config, expected)
  );
}

export function allowlistedAdd(body: Record<string, unknown> | null):
  | { ok: true; body: { product_id: number; quantity: number; options: number[] } }
  | { ok: false; code: string; error: string } {
  const productId = Number(body?.product_id);
  const quantity = Number(body?.quantity ?? 1);
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, code: "MISSING_FIELDS", error: "Product ID is required." };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return {
      ok: false,
      code: "INVALID_QUANTITY",
      error: "Quantity must be a whole number from 1 to 999.",
    };
  }
  if (body?.options != null && !Array.isArray(body.options)) {
    return {
      ok: false,
      code: "INVALID_OPTIONS_FORMAT",
      error: "Options must be a list of option IDs.",
    };
  }
  const options: number[] = [];
  for (const entry of Array.isArray(body?.options) ? body.options : []) {
    if (!Number.isInteger(entry) || entry <= 0) {
      return {
        ok: false,
        code: "INVALID_OPTIONS_FORMAT",
        error: "Options must be a list of option IDs.",
      };
    }
    options.push(entry);
  }
  return { ok: true, body: { product_id: productId, quantity, options } };
}

export function allowlistedUpdate(body: Record<string, unknown> | null):
  | { ok: true; body: { item_id: unknown; quantity: number } }
  | { ok: false; code: string; error: string } {
  const quantity = Number(body?.quantity);
  if (body?.item_id == null || body.item_id === "") {
    return { ok: false, code: "MISSING_FIELDS", error: "Item ID and quantity are required." };
  }
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
    return {
      ok: false,
      code: "INVALID_QUANTITY",
      error: "Quantity must be a whole number from 0 to 999.",
    };
  }
  return { ok: true, body: { item_id: body.item_id, quantity } };
}

export function allowlistedRemove(body: Record<string, unknown> | null):
  | { ok: true; body: { item_id: unknown } }
  | { ok: false; code: string; error: string } {
  if (body?.item_id == null || body.item_id === "") {
    return { ok: false, code: "MISSING_FIELDS", error: "Item ID is required." };
  }
  return { ok: true, body: { item_id: body.item_id } };
}
