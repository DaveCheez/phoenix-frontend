import {
  createError,
  setResponseHeader,
  type H3Event,
} from "h3";

export function cachePublicResponse(
  event: H3Event,
  maxAge = 60,
  staleWhileRevalidate = 300,
): void {
  setResponseHeader(
    event,
    "Cache-Control",
    `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  );
}

export function throwPublicProxyError(
  label: string,
  error: any,
  notFoundMessage?: string,
): never {
  const upstreamStatus = Number(
    error?.response?.status || error?.statusCode || error?.status || 0,
  );
  const upstreamBody = error?.data || error?.response?._data;

  console.error(`[Django ${label} proxy error]`, {
    upstreamStatus: upstreamStatus || null,
    upstreamBody,
    message: error?.message,
    cause: error?.cause?.message || error?.cause,
  });

  if (upstreamStatus === 404 && notFoundMessage) {
    throw createError({
      statusCode: 404,
      statusMessage: notFoundMessage,
      data: { code: `DJANGO_${label.toUpperCase()}_NOT_FOUND` },
    });
  }

  throw createError({
    statusCode: 502,
    statusMessage: `Failed to fetch ${label} from Django API.`,
    data: {
      code: `DJANGO_${label.toUpperCase()}_PROXY_FAILED`,
      upstreamStatus: upstreamStatus || null,
    },
  });
}
