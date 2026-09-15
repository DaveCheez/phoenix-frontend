import { defineEventHandler, getRouterParam } from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");

  if (!slug) {
    return { error: "Category slug is required" };
  }

  try {
    return await djangoFetch(`category/${encodeURIComponent(slug)}/`);
  } catch (error) {
    console.error("[Django category proxy error]", error);
    return { error: "Failed to fetch category data" };
  }
});
