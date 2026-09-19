import { defineEventHandler } from "h3";

import { djangoFetch } from "../utils/django";
import { cachePublicResponse, throwPublicProxyError } from "../utils/publicProxy";

export default defineEventHandler(async (event) => {
  try {
    const data = await djangoFetch(event, "slides/");
    cachePublicResponse(event, 60, 300);
    return data;
  } catch (error: any) {
    throwPublicProxyError("slides", error);
  }
});
