export function proxyError(error: any, fallback: string) {
  const status =
    error?.statusCode || error?.response?.status || error?.status || 500;
  const upstream = error?.data || error?.response?._data || {};

  return {
    success: false,
    code:
      upstream?.code ||
      (status === 404 ? "CART_NOT_FOUND" : "UPSTREAM_REQUEST_FAILED"),
    error: upstream?.error || upstream?.detail || fallback,
    status,
  };
}
