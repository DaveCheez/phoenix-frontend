import { useRuntimeConfig } from "#imports";
import { createError, type H3Event } from "h3";

function cleanBaseUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getDjangoApiBase(event: H3Event): string {
  const runtimeConfig = useRuntimeConfig(event);
  const baseUrl =
    cleanBaseUrl(process.env.NUXT_DJANGO_API_BASE) ||
    cleanBaseUrl(runtimeConfig.djangoApiBase);

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: "Django API base URL is not configured.",
      data: { code: "DJANGO_API_NOT_CONFIGURED" },
    });
  }

  if (!/^https?:\/\//i.test(baseUrl)) {
    throw createError({
      statusCode: 500,
      statusMessage: "Django API base URL is invalid.",
      data: { code: "DJANGO_API_URL_INVALID" },
    });
  }

  return baseUrl;
}

/**
 * Make a request from Nitro to Django using request-aware runtime config.
 * Browser code never receives the private backend base URL.
 */
export async function djangoFetch<T = unknown>(
  event: H3Event,
  path: string,
  options: Record<string, any> = {},
): Promise<T> {
  const baseUrl = getDjangoApiBase(event);
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(cleanPath, `${baseUrl}/`).toString();

  return await $fetch<T>(url, {
    timeout: 15_000,
    retry: 0,
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
    },
  } as any);
}
