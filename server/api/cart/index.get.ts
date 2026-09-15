import { defineEventHandler, getQuery } from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const { cart_id: cartId } = getQuery(event);

  if (typeof cartId !== "string" || !cartId) {
    return { success: false, error: "Missing cart_id" };
  }

  try {
    return await djangoFetch(
      `cart/?cart_id=${encodeURIComponent(cartId)}`,
      { method: "GET" }
    );
  } catch (error: any) {
    console.error("Fetch cart proxy error:", error?.data || error);
    return { success: false, error: "Could not fetch cart" };
  }
});
