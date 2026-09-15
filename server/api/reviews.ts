import { defineEventHandler } from "h3";
import { djangoFetch } from "../utils/django";

export default defineEventHandler(async () => {
  try {
    return await djangoFetch("reviews/");
  } catch (error) {
    console.error("[Django reviews proxy error]", error);
    return { error: "Unable to load reviews" };
  }
});
