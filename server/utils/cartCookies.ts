import { randomBytes } from "node:crypto";
import type { H3Event } from "h3";
import { deleteCookie, setCookie } from "h3";

import type { CartConfig } from "./cartConfig";

export const LEGACY_CART_COOKIE = "cart_id";
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BOOTSTRAP_PATTERN = /^[0-9a-f]{64}$/;
const MAX_EXPIRY_MS = 366 * 24 * 60 * 60 * 1000;

export function guestCookieName(dev: boolean): string {
  return dev ? "phoenix_guest_dev" : "__Host-phoenix_guest";
}

export function bootstrapCookieName(dev: boolean): string {
  return dev ? "phoenix_cart_bootstrap_dev" : "__Host-phoenix_cart_bootstrap";
}

export type CookieRead =
  | { status: "absent" }
  | { status: "ambiguous" }
  | { status: "malformed"; value: string }
  | { status: "present"; value: string };

export function readNamedCookie(
  cookieHeader: string | undefined,
  name: string,
  pattern: RegExp,
): CookieRead {
  if (!cookieHeader) return { status: "absent" };
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const cookieName = part.slice(0, separator).trim();
    if (cookieName !== name) continue;
    values.push(part.slice(separator + 1).trim());
  }
  if (values.length === 0) return { status: "absent" };
  if (values.length > 1) return { status: "ambiguous" };
  let value = values[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    return { status: "malformed", value };
  }
  if (!pattern.test(value)) return { status: "malformed", value };
  return { status: "present", value };
}

export function readGuestCookie(
  cookieHeader: string | undefined,
  dev: boolean,
): CookieRead {
  return readNamedCookie(cookieHeader, guestCookieName(dev), GUEST_TOKEN_PATTERN);
}

export function readBootstrapCookie(
  cookieHeader: string | undefined,
  dev: boolean,
): CookieRead {
  return readNamedCookie(
    cookieHeader,
    bootstrapCookieName(dev),
    BOOTSTRAP_PATTERN,
  );
}

export function cookieHeader(event: H3Event): string | undefined {
  const header = event.node?.req?.headers?.cookie;
  return typeof header === "string" ? header : undefined;
}

export function hasLegacyCartCookie(cookieHeaderValue: string | undefined): boolean {
  if (!cookieHeaderValue) return false;
  return cookieHeaderValue.split(";").some((part) => {
    const name = part.slice(0, part.indexOf("=")).trim();
    return name === LEGACY_CART_COOKIE;
  });
}

export function validateIssuance(payload: unknown, now = Date.now()):
  | {
      ok: true;
      token: string;
      expiresAt: Date;
      cart: Record<string, unknown>;
    }
  | { ok: false; reason: "protocol" | "expired" } {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "protocol" };
  const body = payload as Record<string, unknown>;
  const access = body.guest_access;
  if (!access || typeof access !== "object") return { ok: false, reason: "protocol" };
  const token = String((access as Record<string, unknown>).token || "");
  const expiresText = String((access as Record<string, unknown>).expires_at || "");
  if (!GUEST_TOKEN_PATTERN.test(token)) return { ok: false, reason: "protocol" };
  const expiresAt = new Date(expiresText);
  const expiresMs = expiresAt.getTime();
  if (!Number.isFinite(expiresMs)) return { ok: false, reason: "protocol" };
  if (expiresMs <= now || expiresMs > now + MAX_EXPIRY_MS) {
    return { ok: false, reason: "expired" };
  }
  const cart = publicCart(body.cart);
  if (!cart) return { ok: false, reason: "protocol" };
  return { ok: true, token, expiresAt, cart };
}

const ITEM_FIELDS = [
  "item_id",
  "product_id",
  "product_slug",
  "name",
  "quantity",
  "sku",
  "image",
  "base_unit_price",
  "options_total",
  "configured_unit_price",
  "price",
  "line_total",
  "configuration_signature",
  "configuration_valid",
] as const;

export function publicCart(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const cart = value as Record<string, unknown>;
  if (!Array.isArray(cart.items)) return null;
  const id = typeof cart.id === "string" ? cart.id : "";
  return {
    id,
    items: cart.items.map((item) => publicItem(item)),
    item_count: cart.item_count,
    total: typeof cart.total === "string" ? cart.total : undefined,
  };
}

function publicItem(value: unknown): Record<string, unknown> {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const copy: Record<string, unknown> = {};
  for (const field of ITEM_FIELDS) {
    if (field in item) copy[field] = item[field];
  }
  if (Array.isArray(item.selected_options)) {
    copy.selected_options = item.selected_options.map((option) => {
      const source = option && typeof option === "object"
        ? (option as Record<string, unknown>)
        : {};
      return {
        group_id: source.group_id,
        group_name: source.group_name,
        option_id: source.option_id,
        option_name: source.option_name,
        price_adjustment: source.price_adjustment,
      };
    });
  }
  return copy;
}

function cookieFlags(config: CartConfig, maxAge: number, expires?: Date) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: !config.dev,
    maxAge,
    ...(expires ? { expires } : {}),
  };
}

export function writeGuestCookie(
  event: H3Event,
  config: CartConfig,
  token: string,
  expiresAt: Date,
  now = Date.now(),
): void {
  const maxAge = Math.floor((expiresAt.getTime() - now) / 1000);
  setCookie(event, guestCookieName(config.dev), token, cookieFlags(config, maxAge, expiresAt));
}

export function writeBootstrapCookie(event: H3Event, config: CartConfig): string {
  const existing = readBootstrapCookie(cookieHeader(event), config.dev);
  const token = existing.status === "present" ? existing.value : randomBytes(32).toString("hex");
  if (existing.status !== "present") {
    setCookie(
      event,
      bootstrapCookieName(config.dev),
      token,
      cookieFlags(config, 15 * 60),
    );
  }
  return token;
}

export function clearGuestCookie(event: H3Event, config: CartConfig): void {
  deleteCookie(event, guestCookieName(config.dev), {
    path: "/",
    sameSite: "lax",
    secure: !config.dev,
  });
}

export function clearBootstrapCookie(event: H3Event, config: CartConfig): void {
  deleteCookie(event, bootstrapCookieName(config.dev), {
    path: "/",
    sameSite: "lax",
    secure: !config.dev,
  });
}

export function clearLegacyCartCookie(event: H3Event, config: CartConfig): void {
  deleteCookie(event, LEGACY_CART_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: !config.dev,
  });
}
