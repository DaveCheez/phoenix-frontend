import { defineEventHandler, getRouterParam } from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");

  if (!slug) {
    return { error: "Product slug is required" };
  }

  try {
    return await djangoFetch(`products/${encodeURIComponent(slug)}/`);
  } catch (error) {
    console.error("[Django product proxy error]", error);
    return { error: "Failed to load product" };
  }
});
