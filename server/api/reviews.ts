import { defineEventHandler } from "h3";

import { djangoFetch } from "../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../utils/publicProxy";

export default defineEventHandler(async (event) => {
  try {
    const data = await djangoFetch(event, "reviews/");
    cachePublicResponse(event, 300, 900);
    return data;
  } catch (error: any) {
    throwPublicProxyError("reviews", error);
  }
});
