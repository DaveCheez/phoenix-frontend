import { defineEventHandler } from "h3";

import {
  clearCartId,
  createCart,
  isCartNotFoundError,
  readCartId,
  writeCartId,
} from "../../utils/cartSession";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const existingCartId = readCartId(event);

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
