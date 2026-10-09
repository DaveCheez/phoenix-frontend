import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_LENGTH = 220;

export type CsrfContext = "bootstrap" | "guest";

function macFor(
  secret: string,
  context: CsrfContext,
  nonce: string,
  expiry: number,
  binding: string,
): string {
  const message = [
    "v1",
    context,
    nonce,
    String(expiry),
    String(binding.length),
    binding,
  ].join("\n");
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(message)
    .digest("hex");
}

export function issueCsrfToken(input: {
  secret: string;
  context: CsrfContext;
  binding: string;
  now?: number;
  ttlMs?: number;
}): string {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? CSRF_TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const expiry = Math.floor((now + ttlMs) / 1000);
  const mac = macFor(input.secret, input.context, nonce, expiry, input.binding);
  return `v1.${input.context}.${nonce}.${expiry}.${mac}`;
}

export function verifyCsrfToken(input: {
  secret: string;
  token: unknown;
  context: CsrfContext;
  binding: string;
  now?: number;
  ttlMs?: number;
}): boolean {
  const token = typeof input.token === "string" ? input.token : "";
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const [version, context, nonce, expiryText, mac] = parts;
  if (version !== "v1" || context !== input.context) return false;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) return false;
  if (!/^[0-9]{1,12}$/.test(expiryText)) return false;

  const expiry = Number(expiryText);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const ttlSeconds = Math.floor((input.ttlMs ?? CSRF_TTL_MS) / 1000);
  if (!Number.isSafeInteger(expiry)) return false;
  if (expiry <= nowSeconds) return false;
  if (expiry > nowSeconds + ttlSeconds + 60) return false;

  const expected = macFor(
    input.secret,
    input.context,
    nonce,
    expiry,
    input.binding,
  );
  const actualBuffer = Buffer.from(mac, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    actualBuffer.length !== 32
  ) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
