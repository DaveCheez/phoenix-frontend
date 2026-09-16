import { defineEventHandler, getCookie, getQuery } from "h3";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const cartId =
    typeof query.cart_id === "string"
      ? query.cart_id
      : getCookie(event, "cart_id");

  if (!cartId) {
    return {
      success: false,
      code: "MISSING_CART_ID",
      error: "Missing cart_id",
    };
  }

  try {
    return await djangoFetch(`cart/?cart_id=${encodeURIComponent(cartId)}`, {
      method: "GET",
    });
  } catch (error: any) {
    console.error("Fetch cart proxy error:", error?.data || error);
    return proxyError(error, "Could not fetch cart");
  }
});
