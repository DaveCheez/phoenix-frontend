import { defineEventHandler, getQuery } from "h3";
import { djangoFetch } from "../utils/django";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const type = typeof query.type === "string" ? query.type : "product";

  try {
    return await djangoFetch(
      `categories/?type=${encodeURIComponent(type)}`
    );
  } catch (error) {
    console.error("[Django accessories proxy error]", error);
    return { error: "Failed to fetch accessories from Django API" };
  }
});
