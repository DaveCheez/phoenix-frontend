import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (
    !body?.item_id ||
    !body?.cart_id ||
    typeof body.quantity !== "number"
  ) {
    return {
      success: false,
      code: "MISSING_FIELDS",
      error: "Item ID, cart ID and quantity are required",
    };
  }

  try {
    return await djangoFetch("cart/update/", {
      method: "PATCH",
      body: {
        item_id: body.item_id,
        cart_id: body.cart_id,
        quantity: body.quantity,
      },
    });
  } catch (error: any) {
    console.error("Update cart proxy error:", error?.data || error);
    return proxyError(error, "Could not update cart item");
  }
});
