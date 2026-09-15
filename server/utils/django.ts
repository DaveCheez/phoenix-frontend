import { useRuntimeConfig } from "#imports";
import { createError } from "h3";

/**
 * Make a server-side request to the Django API.
 * The backend base URL stays private and can be changed without rebuilding
 * browser assets by setting NUXT_DJANGO_API_BASE at runtime.
 */
export async function djangoFetch<T = unknown>(
  path: string,
  options: Record<string, unknown> = {}
): Promise<T> {
  const config = useRuntimeConfig();
  const baseUrl = String(config.djangoApiBase || "").replace(/\/+$/, "");

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: "Django API base URL is not configured.",
    });
  }

  const cleanPath = path.replace(/^\/+/, "");
  return await $fetch<T>(`${baseUrl}/${cleanPath}`, options as never);
}
