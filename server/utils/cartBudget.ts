import type { H3Event } from "h3";

import { logCartEvent, type CartConfig } from "./cartConfig";
import {
  RATE_LIMITED_ERROR,
  readProtectedUpstream,
  selectShopperAddress,
  withRetryAfter,
  type UpstreamResult,
} from "./cartTransport";

export type BudgetTransport = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

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

const TEMPORARY = {
  status: 503,
  code: "CART_TEMPORARILY_UNAVAILABLE",
  error: "The basket service is unavailable. Please try again.",
};

export type BudgetOperation = "csrf" | "reset";

export function isBudgetOperation(value: unknown): value is BudgetOperation {
  return value === "csrf" || value === "reset";
}

function unavailable(category: string): UpstreamResult {
  return { ok: false, ...GENERIC, category };
}

function configuration(category = "configuration"): UpstreamResult {
  return { ok: false, ...CONFIGURATION, category };
}

export function classifyBudgetResponse(
  status: number,
  payload: unknown,
  parsed: boolean,
): UpstreamResult {
  if (!parsed || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return unavailable("unexpected");
  }
  const body = payload as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (
    status === 200 &&
    keys.length === 2 &&
    keys[0] === "code" &&
    keys[1] === "success" &&
    body.success === true &&
    body.code === "CART_BUDGET_ALLOWED"
  ) {
    return { ok: true, status: 200, body: { success: true, code: "CART_BUDGET_ALLOWED" } };
  }
  if (
    status === 429 &&
    body.success === false &&
    body.code === "CART_RATE_LIMITED"
  ) {
    return {
      ok: false,
      status: 429,
      code: "CART_RATE_LIMITED",
      error: RATE_LIMITED_ERROR,
      category: "limited",
    };
  }
  if (status === 503 && body.code === "CART_APPLICATION_REJECTED") {
    return { ok: false, ...GENERIC, category: "application" };
  }
  if (status === 503 && body.code === "CART_TEMPORARILY_UNAVAILABLE") {
    return { ok: false, ...TEMPORARY, category: "unavailable" };
  }
  return unavailable("unexpected");
}

export async function sendCartBudget(input: {
  event: H3Event;
  config: CartConfig;
  operation: BudgetOperation;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<UpstreamResult> {
  if (!isBudgetOperation(input.operation)) return unavailable("unexpected");
  const shopperAddress = selectShopperAddress(
    input.event,
    input.config.dev,
    input.config.trustedIngress,
  );
  if (!shopperAddress) {
    const failure = configuration();
    logCartEvent(failure.category, failure.status);
    return failure;
  }

  const read = await readProtectedUpstream({
    baseUrl: input.baseUrl,
    path: "cart/budget/",
    method: "POST",
    body: { operation: input.operation },
    appCredential: input.config.appCredential,
    shopperAddress,
    fetchImpl: input.fetchImpl,
  });
  const classified = read.kind === "configuration"
    ? configuration()
    : read.kind === "network"
      ? unavailable("network")
      : read.kind === "redirect"
        ? unavailable("redirect")
        : withRetryAfter(
          classifyBudgetResponse(read.status, read.payload, read.parsed),
          read.retryAfterHeader,
        );
  if (!classified.ok) logCartEvent(classified.category, classified.status);
  return classified;
}
