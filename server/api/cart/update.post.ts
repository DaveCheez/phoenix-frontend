import { defineEventHandler, readBody } from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (
    !body?.item_id ||
    !body?.cart_id ||
    typeof body.quantity !== "number"
  ) {
    return {
      success: false,
      error: "Item ID, cart ID and quantity are required",
    };
  }

  try {
    return await djangoFetch("cart/update/", {
      method: "POST",
      body: {
        item_id: body.item_id,
        cart_id: body.cart_id,
        quantity: body.quantity,
      },
    });
  } catch (error: any) {
    console.error("Update cart proxy error:", error?.data || error);
    return { success: false, error: "Could not update cart item" };
  }
});
