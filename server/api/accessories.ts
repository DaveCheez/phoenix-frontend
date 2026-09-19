import { defineEventHandler, getQuery } from "h3";

import { djangoFetch } from "../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../utils/publicProxy";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const type = typeof query.type === "string" ? query.type : "product";

  try {
    const data = await djangoFetch(
      event,
      `categories/?type=${encodeURIComponent(type)}`,
    );
    cachePublicResponse(event, 60, 300);
    return data;
  } catch (error: any) {
    throwPublicProxyError("accessories", error);
  }
});
