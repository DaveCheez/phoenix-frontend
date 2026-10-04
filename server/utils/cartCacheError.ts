import type { H3Event } from "h3";
import { getRequestURL, getResponseHeader, send, setResponseHeaders, setResponseStatus } from "h3";

import { isCartCachePath, withCartCacheHeaders } from "./cartCachePolicy";

type FrameworkErrorResult = {
  status?: number;
  statusText?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
};

// Nitro's built-in error handler writes Cache-Control: no-cache and ends the
// response before the beforeResponse hook. For cart paths, send that same
// framework body ourselves so the cache policy is on the final headers.
export default async function cartCacheErrorHandler(
  error: unknown,
  event: H3Event,
  context: { defaultHandler?: (error: unknown, event: H3Event) => Promise<FrameworkErrorResult> | FrameworkErrorResult },
) {
  let pathname = "";
  try {
    pathname = getRequestURL(event).pathname;
  } catch {
    return;
  }
  if (!isCartCachePath(pathname) || !context?.defaultHandler) return;

  const result = await context.defaultHandler(error, event);
  if (!result || typeof result !== "object") return;
  const headers = withCartCacheHeaders(result.headers || {}, getResponseHeader(event, "vary"));
  if (!event.node?.res.headersSent) setResponseHeaders(event, headers);
  setResponseStatus(event, result.status || 500, result.statusText);
  const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
  return send(event, body);
}
