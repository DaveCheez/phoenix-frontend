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

export function upstreamHeaders(bearer?: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return headers;
}

export function classifyUpstream(
  status: number,
  payload: unknown,
  bearer?: string,
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
    let error = typeof body.error === "string" ? body.error.slice(0, 300) : "";
    if (bearer && error.includes(bearer)) error = "Cart access is not available.";
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
    return { ok: false, ...GENERIC, status: status === 429 ? 503 : 503, category: "unavailable" };
  }
  return { ok: false, ...GENERIC, category: "unexpected" };
}

export async function cartUpstream(input: {
  baseUrl: string;
  path: string;
  method: string;
  body?: Record<string, unknown>;
  bearer?: string;
  fetchImpl?: typeof fetch;
}): Promise<UpstreamResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const url = new URL(input.path.replace(/^\/+/, ""), `${input.baseUrl.replace(/\/+$/, "")}/`);
  const headers = upstreamHeaders(input.bearer);
  if (input.body) headers["content-type"] = "application/json";

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
    return classifyUpstream(response.status, null, input.bearer);
  }
  return classifyUpstream(response.status, payload, input.bearer);
}
