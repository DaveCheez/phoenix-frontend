import { setResponseStatus, type H3Event } from "h3";

function upstreamStatus(error: any): number {
  const candidate = Number(
    error?.response?.status ||
      error?.statusCode ||
      error?.status ||
      error?.cause?.statusCode ||
      0,
  );

  return candidate >= 400 && candidate <= 599 ? candidate : 502;
}

export function proxyError(event: H3Event, error: any, fallback: string) {
  const status = upstreamStatus(error);
  const upstream = error?.data || error?.response?._data || {};

  setResponseStatus(event, status);

  return {
    success: false,
    code:
      upstream?.code ||
      (status === 404 ? "CART_NOT_FOUND" : "UPSTREAM_REQUEST_FAILED"),
    error:
      upstream?.error || upstream?.detail || error?.statusMessage || fallback,
    upstream_status: status,
  };
}
