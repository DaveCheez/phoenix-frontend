import type { H3Event } from "h3";
import { getRequestURL, getResponseHeader, setResponseHeader } from "h3";

export const CART_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate";

export function isCartCachePath(pathname: string): boolean {
  return pathname === "/api/cart" || pathname.startsWith("/api/cart/");
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(", ");
  return typeof value === "string" ? value : "";
}

// null means the existing Vary header must be left unchanged.
export function mergeVaryCookie(existing: unknown): string | null {
  const tokens = headerText(existing)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => token === "*")) return null;
  if (tokens.some((token) => token.toLowerCase() === "cookie")) return tokens.join(", ");
  return [...tokens, "Cookie"].join(", ");
}

export function writeCartCacheHeaders(event: H3Event): void {
  setResponseHeader(event, "Cache-Control", CART_CACHE_CONTROL);
  setResponseHeader(event, "Pragma", "no-cache");
  const merged = mergeVaryCookie(getResponseHeader(event, "vary"));
  if (merged != null) setResponseHeader(event, "Vary", merged);
}

export function applyCartCachePolicy(event: H3Event): void {
  let pathname = "";
  try {
    pathname = getRequestURL(event).pathname;
  } catch {
    return;
  }
  if (!isCartCachePath(pathname)) return;
  writeCartCacheHeaders(event);
}

export function withCartCacheHeaders(
  headers: Record<string, unknown>,
  existingVary: unknown,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const text = headerText(value);
    if (text) next[key] = text;
  }
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "cache-control" && key !== "cache-control") delete next[key];
  }
  next["cache-control"] = CART_CACHE_CONTROL;
  const pragmaKey = Object.keys(next).find((key) => key.toLowerCase() === "pragma");
  if (pragmaKey) next[pragmaKey] = "no-cache";
  else next.pragma = "no-cache";

  const varyKey = Object.keys(next).find((key) => key.toLowerCase() === "vary");
  const combined = [varyKey ? next[varyKey] : "", headerText(existingVary)].filter(Boolean).join(", ");
  const merged = mergeVaryCookie(combined);
  if (merged != null) {
    if (varyKey) next[varyKey] = merged;
    else next.vary = merged;
  }
  return next;
}
