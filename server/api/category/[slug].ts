import { createError, defineEventHandler, getRouterParam } from "h3";

import { djangoFetch } from "../../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../../utils/publicProxy";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: "Category slug is required.",
    });
  }

  try {
    const data = await djangoFetch(
      event,
      `category/${encodeURIComponent(slug)}/`,
    );
    cachePublicResponse(event, 60, 300);
    return data;
  } catch (error: any) {
    throwPublicProxyError("category", error, "Category not found.");
  }
});
