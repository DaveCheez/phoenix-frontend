import { defineEventHandler, getQuery } from "h3";
import { djangoFetch } from "../utils/django";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const categoryId =
    typeof query.category_id === "string" ? query.category_id : "";
  const suffix = categoryId
    ? `?category_id=${encodeURIComponent(categoryId)}`
    : "";

  try {
    return await djangoFetch(`products/${suffix}`);
  } catch (error) {
    console.error("[Django products proxy error]", error);
    return { error: "Failed to fetch products from Django API" };
  }
});
