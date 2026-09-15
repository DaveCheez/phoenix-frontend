import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body?.item_id || !body?.cart_id) {
    return { success: false, error: "Item ID and cart ID are required" };
  }

  try {
    return await djangoFetch("cart/remove/", {
      method: "POST",
      body: {
        item_id: body.item_id,
        cart_id: body.cart_id,
      },
    });
  } catch (error: any) {
    console.error("Remove from cart proxy error:", error?.data || error);
    return { success: false, error: "Could not remove item" };
  }
});
