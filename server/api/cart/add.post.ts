import { defineEventHandler, readBody } from "h3";

import {
  clearCartId,
  createCart,
  ensureCartId,
  isCartNotFoundError,
} from "../../utils/cartSession";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body?.product_id) {
    return {
      success: false,
      code: "MISSING_FIELDS",
      error: "Product ID is required",
    };
  }

  const add = async (cartId: string) =>
    await djangoFetch("cart/add/", {
      method: "POST",
      body: {
        cart_id: cartId,
        product_id: body.product_id,
        quantity: body.quantity ?? 1,
        options: body.options ?? {},
      },
    });

  try {
    let cartId = await ensureCartId(event, body.cart_id);

    try {
      return await add(cartId);
    } catch (error: any) {
      if (!isCartNotFoundError(error)) throw error;

      clearCartId(event);
      const created = await createCart(event);
      cartId = created.cart_id;
      return await add(cartId);
    }
  } catch (error: any) {
    console.error("Cart add proxy error:", error?.data || error);
    return proxyError(error, "Failed to add item to cart");
  }
});
