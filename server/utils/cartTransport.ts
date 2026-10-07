import { isIP } from "node:net";
import type { H3Event } from "h3";

import { isAppCredential } from "./cartConfig";
import { headerValues } from "./cartGuard";

export const SAFE_UPSTREAM_CODES = new Set([
  "CART_ACCESS_UNAVAILABLE",
  "GUEST_CART_MISSING",
  "CART_TEMPORARILY_UNAVAILABLE",
  "MISSING_FIELDS",
  "INVALID_OPTIONS_FORMAT",
  "INVALID_OPTION",
  "DUPLICATE_OPTION",
  "DUPLICATE_GROUP_SELECTION",
  "MISSING_REQUIRED_OPTION",
  "UNEXPECTED_PRICE_FIELD",
  "CONFIGURATION_CONFLICT",
  "INVALID_QUANTITY",
  "CART_NOT_FOUND",
]);

export type UpstreamResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; error: string; category: string };

const GENERIC = {
  status: 503,
  code: "CART_SERVICE_UNAVAILABLE",
  error: "The basket service is unavailable. Please try again.",
};

const CONFIGURATION = {
  status: 503,
  code: "CART_SERVICE_CONFIGURATION",
  error: "The basket service is not available.",
};

export const DEVELOPMENT_SHOPPER_ADDRESS = "127.0.0.1";

type TransportSecrets = {
  bearer?: string;
  appCredential?: string;
  shopperAddress?: string;
};

export function selectShopperAddress(
  event: H3Event,
  dev: boolean,
  trustedIngress: string,
): string | null {
  if (dev) return DEVELOPMENT_SHOPPER_ADDRESS;
  if (trustedIngress !== "digitalocean") return null;
  const values = headerValues(event, "do-connecting-ip");
  if (values.length !== 1) return null;
  const value = values[0];
  if (!isAcceptedAddress(value)) return null;
  return value;
}

function isAcceptedAddress(value: string): boolean {
  if (!value || value !== value.trim()) return false;
  if (/[\s,/%[\]]/.test(value)) return false;
  return isIP(value) !== 0;
}

export function credentialUpstreamAllowed(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

export function upstreamHeaders(input: {
  bearer?: string;
  appCredential: string;
  shopperAddress: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "X-Phoenix-App-Credential": input.appCredential,
    "X-Phoenix-Shopper-Address": input.shopperAddress,
  };
  if (input.bearer) headers.authorization = `Bearer ${input.bearer}`;
  return headers;
}

function redactError(error: string, secrets?: TransportSecrets): string {
  const hidden = [secrets?.bearer, secrets?.appCredential, secrets?.shopperAddress];
  for (const value of hidden) {
    if (value && error.includes(value)) return "The basket request was rejected.";
  }
  return error;
}

export function classifyUpstream(
  status: number,
  payload: unknown,
  secrets?: TransportSecrets,
): UpstreamResult {
  if (status >= 300 && status < 400) {
    return { ok: false, ...GENERIC, category: "redirect" };
  }
  if (status >= 200 && status < 300 && payload && typeof payload === "object") {
    return { ok: true, status, body: payload as Record<string, unknown> };
  }
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code : "";
    if (status === 503 && code === "CART_APPLICATION_REJECTED") {
      return { ok: false, ...GENERIC, category: "application" };
    }
    if (status === 429 && code === "CART_RATE_LIMITED") {
      return {
        ok: false,
        status: 429,
        code: "CART_RATE_LIMITED",
        error: GENERIC.error,
        category: "upstream",
      };
    }
    const error = redactError(
      typeof body.error === "string" ? body.error.slice(0, 300) : "",
      secrets,
    );
    const sessionCode =
      (status === 401 && code === "CART_ACCESS_UNAVAILABLE") ||
      (status === 409 && code === "GUEST_CART_MISSING") ||
      (status === 503 && code === "CART_TEMPORARILY_UNAVAILABLE");
    const validationCode =
      status >= 400 &&
      status < 500 &&
      SAFE_UPSTREAM_CODES.has(code) &&
      code !== "CART_ACCESS_UNAVAILABLE" &&
      code !== "GUEST_CART_MISSING";
    if (sessionCode || validationCode) {
      return {
        ok: false,
        status,
        code,
        error: error || "The basket request was rejected.",
        category: "upstream",
      };
    }
  }
  if (status === 429 || status >= 500) {
    return { ok: false, ...GENERIC, category: "unavailable" };
  }
  return { ok: false, ...GENERIC, category: "unexpected" };
}

export async function cartUpstream(input: {
  baseUrl: string;
  path: string;
  method: string;
  body?: Record<string, unknown>;
  bearer?: string;
  appCredential: string;
  shopperAddress: string;
  fetchImpl?: typeof fetch;
}): Promise<UpstreamResult> {
  if (
    !isAppCredential(input.appCredential) ||
    !input.shopperAddress ||
    !credentialUpstreamAllowed(input.baseUrl)
  ) {
    return { ok: false, ...CONFIGURATION, category: "configuration" };
  }

  const fetchImpl = input.fetchImpl || fetch;
  const url = new URL(input.path.replace(/^\/+/, ""), `${input.baseUrl.replace(/\/+$/, "")}/`);
  const headers = upstreamHeaders({
    bearer: input.bearer,
    appCredential: input.appCredential,
    shopperAddress: input.shopperAddress,
  });
  if (input.body) headers["content-type"] = "application/json";
  const secrets = {
    bearer: input.bearer,
    appCredential: input.appCredential,
    shopperAddress: input.shopperAddress,
  };

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, ...GENERIC, category: "network" };
  }

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, ...GENERIC, category: "redirect" };
  }

  let payload: unknown = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    return classifyUpstream(response.status, null, secrets);
  }
  return classifyUpstream(response.status, payload, secrets);
}

export async function dispatchCartUpstream(
  event: H3Event,
  config: { dev: boolean; trustedIngress: string; appCredential: string },
  input: {
    baseUrl: string;
    path: string;
    method: string;
    body?: Record<string, unknown>;
    bearer?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<UpstreamResult> {
  if (!isAppCredential(config.appCredential)) {
    return { ok: false, ...CONFIGURATION, category: "configuration" };
  }
  const shopperAddress = selectShopperAddress(event, config.dev, config.trustedIngress);
  if (!shopperAddress) {
    return { ok: false, ...CONFIGURATION, category: "configuration" };
  }
  return cartUpstream({
    baseUrl: input.baseUrl,
    path: input.path,
    method: input.method,
    body: input.body,
    bearer: input.bearer,
    appCredential: config.appCredential,
    shopperAddress,
    fetchImpl: input.fetchImpl,
  });
}
