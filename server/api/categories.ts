import { defineEventHandler, getQuery } from "h3";

import { djangoFetch } from "../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../utils/publicProxy";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const categoryType =
    typeof query.type === "string" ? query.type : query.van ? "van" : "product";

  try {
    const data = await djangoFetch(
      event,
      `categories/?type=${encodeURIComponent(categoryType)}`,
    );
    cachePublicResponse(event, 60, 300);
    return data;
  } catch (error: any) {
    throwPublicProxyError("categories", error);
  }
});
