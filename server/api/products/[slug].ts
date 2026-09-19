import { createError, defineEventHandler, getRouterParam } from "h3";

import { djangoFetch } from "../../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../../utils/publicProxy";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: "Product slug is required.",
    });
  }

  try {
    const data = await djangoFetch(
      event,
      `products/${encodeURIComponent(slug)}/`,
    );
    cachePublicResponse(event, 30, 120);
    return data;
  } catch (error: any) {
    throwPublicProxyError("product", error, "Product not found.");
  }
});
