import type { H3Event } from "h3";
import { readBody, setResponseHeader, setResponseStatus } from "h3";

import { sendCartBudget, type BudgetTransport } from "./cartBudget";
import { logCartEvent, type CartConfig } from "./cartConfig";
import { issueCsrfToken } from "./cartCsrf";
import {
  clearBootstrapCookie,
  clearGuestCookie,
  clearLegacyCartCookie,
  cookieHeader,
  hasLegacyCartCookie,
  publicCart,
  readGuestCookie,
  validateIssuance,
  writeBootstrapCookie,
  writeGuestCookie,
} from "./cartCookies";
import {
  allowlistedAdd,
  allowlistedRemove,
  allowlistedUpdate,
  csrfReadAllowed,
  mutationGuards,
} from "./cartGuard";
import type { UpstreamResult } from "./cartTransport";

export type DjangoCall = (input: {
  path: string;
  method: string;
  body?: Record<string, unknown>;
  bearer?: string;
}) => Promise<UpstreamResult>;

export function cartFailure(
  event: H3Event,
  status: number,
  code: string,
  error: string,
  retryAfter?: number,
) {
  setResponseStatus(event, status);
  if (status === 429 && code === "CART_RATE_LIMITED" && retryAfter != null) {
    setResponseHeader(event, "retry-after", String(retryAfter));
  }
  return { success: false, code, error };
}

export function guardFailure(event: H3Event) {
  return cartFailure(
    event,
    403,
    "CART_REQUEST_REJECTED",
    "The basket request was rejected.",
  );
}

export function browserCartResult(event: H3Event, result: UpstreamResult) {
  if (!result.ok) return cartFailure(event, result.status, result.code, result.error, result.retryAfter);
  const cart = publicCart(result.body.cart);
  if (!cart) {
    logCartEvent("protocol", result.status);
    return cartFailure(
      event,
      502,
      "CART_PROTOCOL_INCOMPATIBLE",
      "The basket service returned an unexpected response.",
    );
  }
  setResponseStatus(event, result.status);
  return { success: result.body.success !== false, cart };
}

function sessionRequired(event: H3Event, message: string) {
  return cartFailure(event, 401, "CART_SESSION_REQUIRED", message);
}

export async function handleCsrf(
  event: H3Event,
  config: CartConfig,
  transport: BudgetTransport,
) {
  if (!csrfReadAllowed(event, config)) return guardFailure(event);
  const decision = await sendCartBudget({
    event,
    config,
    operation: "csrf",
    baseUrl: transport.baseUrl,
    fetchImpl: transport.fetchImpl,
  });
  if (!decision.ok) {
    return cartFailure(event, decision.status, decision.code, decision.error, decision.retryAfter);
  }
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  const binding = guest.status === "present"
    ? { context: "guest" as const, value: guest.value }
    : { context: "bootstrap" as const, value: writeBootstrapCookie(event, config) };
  setResponseStatus(event, 200);
  return {
    success: true,
    csrf_token: issueCsrfToken({
      secret: config.secret,
      context: binding.context,
      binding: binding.value,
    }),
  };
}

export async function handleGet(
  event: H3Event,
  config: CartConfig,
  django: DjangoCall,
) {
  const header = cookieHeader(event);
  const guest = readGuestCookie(header, config.dev);
  if (guest.status === "absent") {
    setResponseStatus(event, 401);
    return {
      success: false,
      code: "CART_SESSION_REQUIRED",
      error: "Start a basket before viewing it.",
      legacy_marker: hasLegacyCartCookie(header),
    };
  }
  if (guest.status !== "present") {
    return cartFailure(event, 401, "CART_ACCESS_UNAVAILABLE", "Cart access is not available.");
  }
  return browserCartResult(event, await django({
    path: "cart/",
    method: "GET",
    bearer: guest.value,
  }));
}

export async function handleCreate(
  event: H3Event,
  config: CartConfig,
  django: DjangoCall,
) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  const context = guest.status === "absent" ? "bootstrap" : "guest";
  if (!mutationGuards(event, config, context)) return guardFailure(event);
  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  const action = body?.action;

  if (action === "start") {
    if (guest.status === "ambiguous" || guest.status === "malformed") {
      return cartFailure(event, 401, "CART_ACCESS_UNAVAILABLE", "Cart access is not available.");
    }
    const result = await django({
      path: "cart/create/",
      method: "POST",
      body: { action: "start" },
      bearer: guest.status === "present" ? guest.value : undefined,
    });
    if (!result.ok) return cartFailure(event, result.status, result.code, result.error, result.retryAfter);
    if (guest.status === "absent") {
      const issued = validateIssuance(result.body);
      if (!issued.ok) {
        return cartFailure(
          event,
          502,
          "CART_PROTOCOL_INCOMPATIBLE",
          "The basket service returned an unexpected response.",
        );
      }
      writeGuestCookie(event, config, issued.token, issued.expiresAt);
      clearLegacyCartCookie(event, config);
      setResponseStatus(event, 201);
      return { success: true, cart: issued.cart };
    }
    const cart = publicCart(result.body.cart);
    if (!cart) {
      return cartFailure(
        event,
        502,
        "CART_PROTOCOL_INCOMPATIBLE",
        "The basket service returned an unexpected response.",
      );
    }
    setResponseStatus(event, result.status);
    return { success: true, cart };
  }

  if (action === "replace_missing") {
    if (guest.status !== "present") {
      return cartFailure(event, 401, "CART_ACCESS_UNAVAILABLE", "Cart access is not available.");
    }
    return browserCartResult(event, await django({
      path: "cart/create/",
      method: "POST",
      body: { action: "replace_missing" },
      bearer: guest.value,
    }));
  }

  return cartFailure(event, 400, "CART_REQUEST_REJECTED", "The basket request was rejected.");
}

async function mutate(
  event: H3Event,
  config: CartConfig,
  django: DjangoCall,
  input: {
    path: string;
    method: string;
    allow: (body: Record<string, unknown> | null) =>
      | { ok: true; body: Record<string, unknown> }
      | { ok: false; code: string; error: string };
    emptyMessage: string;
  },
) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  if (guest.status !== "present") return sessionRequired(event, input.emptyMessage);
  if (!mutationGuards(event, config, "guest")) return guardFailure(event);
  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  const allowed = input.allow(body);
  if (!allowed.ok) return cartFailure(event, 400, allowed.code, allowed.error);
  return browserCartResult(event, await django({
    path: input.path,
    method: input.method,
    body: allowed.body,
    bearer: guest.value,
  }));
}

export function handleAdd(event: H3Event, config: CartConfig, django: DjangoCall) {
  return mutate(event, config, django, {
    path: "cart/add/",
    method: "POST",
    allow: allowlistedAdd,
    emptyMessage: "Start a basket before adding a product.",
  });
}

export function handleUpdate(event: H3Event, config: CartConfig, django: DjangoCall) {
  return mutate(event, config, django, {
    path: "cart/update/",
    method: "PATCH",
    allow: allowlistedUpdate,
    emptyMessage: "Start a basket before changing it.",
  });
}

export function handleRemove(event: H3Event, config: CartConfig, django: DjangoCall) {
  return mutate(event, config, django, {
    path: "cart/remove/",
    method: "DELETE",
    allow: allowlistedRemove,
    emptyMessage: "Start a basket before changing it.",
  });
}

export async function handleClear(
  event: H3Event,
  config: CartConfig,
  django: DjangoCall,
) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  if (guest.status !== "present") {
    return sessionRequired(event, "Start a basket before clearing it.");
  }
  if (!mutationGuards(event, config, "guest")) return guardFailure(event);
  return browserCartResult(event, await django({
    path: "cart/clear/",
    method: "DELETE",
    bearer: guest.value,
  }));
}

export async function handleReset(
  event: H3Event,
  config: CartConfig,
  django: DjangoCall,
  transport: BudgetTransport,
) {
  const guest = readGuestCookie(cookieHeader(event), config.dev);
  const context = guest.status === "present" ? "guest" : "bootstrap";
  if (!mutationGuards(event, config, context)) return guardFailure(event);
  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  if (body?.confirm !== true) {
    return cartFailure(event, 400, "CART_REQUEST_REJECTED", "The basket request was rejected.");
  }
  const decision = await sendCartBudget({
    event,
    config,
    operation: "reset",
    baseUrl: transport.baseUrl,
    fetchImpl: transport.fetchImpl,
  });
  if (!decision.ok) {
    return cartFailure(event, decision.status, decision.code, decision.error, decision.retryAfter);
  }
  if (guest.status === "absent") {
    clearBootstrapCookie(event, config);
    setResponseStatus(event, 200);
    return { success: true, code: "CART_SESSION_RESET" };
  }
  if (guest.status === "ambiguous" || guest.status === "malformed") {
    clearGuestCookie(event, config);
    clearBootstrapCookie(event, config);
    setResponseStatus(event, 200);
    return { success: true, code: "CART_SESSION_RESET" };
  }
  const result = await django({ path: "cart/", method: "GET", bearer: guest.value });
  if (result.ok) {
    const restored = browserCartResult(event, result);
    return {
      ...restored,
      success: false,
      code: "CART_STILL_AVAILABLE",
      error: "This basket is still available.",
    };
  }
  if (result.status === 409 && result.code === "GUEST_CART_MISSING") {
    return cartFailure(event, 409, "GUEST_CART_MISSING", "This guest session has no cart.");
  }
  if (result.status === 401 && result.code === "CART_ACCESS_UNAVAILABLE") {
    clearGuestCookie(event, config);
    clearBootstrapCookie(event, config);
    setResponseStatus(event, 200);
    return { success: true, code: "CART_SESSION_RESET" };
  }
  if (result.status === 429 && result.code === "CART_RATE_LIMITED") {
    return cartFailure(event, 429, result.code, result.error, result.retryAfter);
  }
  return cartFailure(
    event,
    503,
    "CART_TEMPORARILY_UNAVAILABLE",
    "The basket service is unavailable. Please try again.",
  );
}
