import { defineEventHandler, getQuery } from "h3";

import { djangoFetch } from "../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../utils/publicProxy";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const categoryId =
    typeof query.category_id === "string" ? query.category_id : "";
  const suffix = categoryId
    ? `?category_id=${encodeURIComponent(categoryId)}`
    : "";

  try {
    const data = await djangoFetch(event, `products/${suffix}`);
    cachePublicResponse(event, 30, 120);
    return data;
  } catch (error: any) {
    throwPublicProxyError("products", error);
  }
});
