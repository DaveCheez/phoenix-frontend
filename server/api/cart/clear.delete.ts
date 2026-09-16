import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!body?.cart_id) {
    return {
      success: false,
      code: "MISSING_CART_ID",
      error: "Cart ID is required",
    };
  }

  try {
    return await djangoFetch("cart/clear/", {
      method: "DELETE",
      body: { cart_id: body.cart_id },
    });
  } catch (error: any) {
    console.error("Clear cart proxy error:", error?.data || error);
    return proxyError(error, "Could not clear the cart");
  }
});
