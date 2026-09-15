import { defineEventHandler, getQuery } from "h3";
import { djangoFetch } from "../utils/django";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const categoryType =
    typeof query.type === "string"
      ? query.type
      : query.van
        ? "van"
        : "product";

  try {
    return await djangoFetch(
      `categories/?type=${encodeURIComponent(categoryType)}`
    );
  } catch (error) {
    console.error("[Django categories proxy error]", error);
    return { error: "Failed to fetch categories from Django API" };
  }
});
