import { defineEventHandler, readBody } from "h3";

import { ensureCartId } from "../../utils/cartSession";
import { markCartResponsePrivate } from "../../utils/cartResponse";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  markCartResponsePrivate(event);
  const body = await readBody(event);

  if (!body?.item_id) {
    return {
      success: false,
      code: "MISSING_FIELDS",
      error: "Item ID is required",
    };
  }

  try {
    const cartId = await ensureCartId(event, body.cart_id);
    return await djangoFetch("cart/remove/", {
      method: "DELETE",
      body: {
        item_id: body.item_id,
        cart_id: cartId,
      },
    });
  } catch (error: any) {
    console.error("Remove from cart proxy error:", error?.data || error);
    return proxyError(error, "Could not remove item");
  }
});
