import { useRuntimeConfig } from "#imports";
import type { H3Event } from "h3";
import { setResponseStatus } from "h3";

import {
  isPlaceholderSecret,
  logCartEvent,
  parseCartOrigin,
  type CartConfig,
} from "./cartConfig";
import { markCartResponsePrivate } from "./cartResponse";
import { cartUpstream, type UpstreamResult } from "./cartTransport";

export function resolveCartConfig(event: H3Event): CartConfig | null {
  const runtimeConfig = useRuntimeConfig(event);
  const secret = String(runtimeConfig.cartCsrfSecret || "").trim();
  const dev = import.meta.dev === true;
  const origin = parseCartOrigin(runtimeConfig.cartOrigin, dev);
  if (!origin || isPlaceholderSecret(secret)) return null;
  return { secret, origin: origin.origin, host: origin.host, dev };
}

export function configurationFailure(event: H3Event) {
  markCartResponsePrivate(event);
  setResponseStatus(event, 503);
  logCartEvent("configuration");
  return {
    success: false,
    code: "CART_SERVICE_CONFIGURATION",
    error: "The basket service is not available.",
  };
}

export function beginCart(event: H3Event):
  | { ok: true; config: CartConfig }
  | { ok: false; body: ReturnType<typeof configurationFailure> } {
  markCartResponsePrivate(event);
  const config = resolveCartConfig(event);
  if (!config) return { ok: false, body: configurationFailure(event) };
  return { ok: true, config };
}

export async function callDjango(
  event: H3Event,
  input: {
    path: string;
    method: string;
    body?: Record<string, unknown>;
    bearer?: string;
  },
): Promise<UpstreamResult> {
  const baseUrl = String(useRuntimeConfig(event).djangoApiBase || "");
  const result = await cartUpstream({
    baseUrl,
    path: input.path,
    method: input.method,
    body: input.body,
    bearer: input.bearer,
  });
  if (!result.ok) logCartEvent(result.category, result.status);
  return result;
}
