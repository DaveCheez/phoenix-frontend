import { defineEventHandler, readBody } from "h3";

import {
  clearCartId,
  createCart,
  isCartNotFoundError,
  readCartId,
  writeCartId,
} from "../../utils/cartSession";
import { markCartResponsePrivate } from "../../utils/cartResponse";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  markCartResponsePrivate(event);
  const body = await readBody(event).catch(() => ({}));
  const existingCartId = readCartId(event, body?.cart_id);

  if (existingCartId) {
    try {
      const data: any = await djangoFetch(
        `cart/?cart_id=${encodeURIComponent(existingCartId)}`,
        { method: "GET" },
      );
      writeCartId(event, existingCartId);
      return {
        success: true,
        cart_id: existingCartId,
        cart: data?.cart,
      };
    } catch (error: any) {
      if (!isCartNotFoundError(error)) {
        console.error("Validate cart proxy error:", error?.data || error);
        return proxyError(error, "Could not validate the cart");
      }
      clearCartId(event);
    }
  }

  try {
    return await createCart(event);
  } catch (error: any) {
    console.error("Create cart proxy error:", error?.data || error);
    return proxyError(error, "Could not create a cart");
  }
});
