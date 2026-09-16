import { defineEventHandler } from "h3";
import { djangoFetch } from "../utils/django";

export default defineEventHandler(async () => {
  try {
    return await djangoFetch("slides/");
  } catch (error) {
    console.error("[Django slides proxy error]", error);
    return [];
  }
});
