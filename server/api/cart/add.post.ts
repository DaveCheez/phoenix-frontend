import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body?.cart_id || !body?.product_id) {
    return {
      success: false,
      code: "MISSING_FIELDS",
      error: "Cart ID and product ID are required",
    };
  }

  try {
    return await djangoFetch("cart/add/", {
      method: "POST",
      body: {
        cart_id: body.cart_id,
        product_id: body.product_id,
        quantity: body.quantity ?? 1,
        options: body.options ?? {},
      },
    });
  } catch (error: any) {
    console.error("Cart add proxy error:", error?.data || error);
    return proxyError(error, "Failed to add item to cart");
  }
});
