import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body?.cart_id || !body?.product_id) {
    return { success: false, error: "Cart ID and product ID are required" };
  }

  try {
    return await djangoFetch("cart/add/", {
      method: "POST",
      body: {
        cart_id: body.cart_id,
        product_id: body.product_id,
        quantity: body.quantity ?? 1,
      },
    });
  } catch (error: any) {
    console.error("Cart add proxy error:", error?.data || error);
    return { success: false, error: "Failed to add item to cart" };
  }
});
