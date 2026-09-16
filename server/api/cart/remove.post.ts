import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body?.item_id || !body?.cart_id) {
    return {
      success: false,
      code: "MISSING_FIELDS",
      error: "Item ID and cart ID are required",
    };
  }

  try {
    return await djangoFetch("cart/remove/", {
      method: "DELETE",
      body: {
        item_id: body.item_id,
        cart_id: body.cart_id,
      },
    });
  } catch (error: any) {
    console.error("Remove from cart proxy error:", error?.data || error);
    return proxyError(error, "Could not remove item");
  }
});
