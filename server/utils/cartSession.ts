import type { H3Event } from "h3";
import { deleteCookie, getCookie, setCookie } from "h3";

import { djangoFetch } from "./django";

const CART_COOKIE = "cart_id";
const CART_MAX_AGE = 60 * 60 * 24 * 30;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Older frontend builds wrote cart_id through Nuxt useCookie, which JSON
 * serialises strings. H3 then sees a value such as `"uuid"`. Accept both the
 * old JSON-encoded form and the new plain UUID form during the transition.
 */
export function normaliseCartId(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  let candidate = value.trim();

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // It may already be decoded by H3.
  }

  if (candidate.startsWith('"') && candidate.endsWith('"')) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") candidate = parsed;
    } catch {
      // Invalid JSON is rejected by the UUID check below.
    }
  }

  return UUID_PATTERN.test(candidate) ? candidate : null;
}

export function readCartId(event: H3Event, fallback?: unknown): string | null {
  return (
    normaliseCartId(getCookie(event, CART_COOKIE)) ||
    normaliseCartId(fallback)
  );
}

export function writeCartId(event: H3Event, cartId: string): void {
  setCookie(event, CART_COOKIE, cartId, {
    httpOnly: true,
    maxAge: CART_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearCartId(event: H3Event): void {
  deleteCookie(event, CART_COOKIE, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function isCartNotFoundError(error: any): boolean {
  const status =
    error?.statusCode || error?.response?.status || error?.status || 0;
  const data = error?.data || error?.response?._data || {};
  return status === 404 || data?.code === "CART_NOT_FOUND";
}

export async function createCart(event: H3Event): Promise<any> {
  const data: any = await djangoFetch("cart/create/", { method: "POST" });
  const cartId = normaliseCartId(data?.cart_id || data?.cart?.id);

  if (!cartId) {
    throw new Error("Django did not return a valid cart ID");
  }

  writeCartId(event, cartId);
  return { ...data, success: data?.success !== false, cart_id: cartId };
}

export async function ensureCartId(
  event: H3Event,
  fallback?: unknown,
): Promise<string> {
  const existing = readCartId(event, fallback);
  if (existing) {
    // Rewrite old JSON-encoded/non-HttpOnly cookies in one canonical form.
    writeCartId(event, existing);
    return existing;
  }

  const created = await createCart(event);
  return created.cart_id;
}
