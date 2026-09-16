import { defineEventHandler, getQuery } from "h3";

import {
  clearCartId,
  createCart,
  ensureCartId,
  isCartNotFoundError,
  writeCartId,
} from "../../utils/cartSession";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

async function fetchCart(cartId: string) {
  return await djangoFetch(`cart/?cart_id=${encodeURIComponent(cartId)}`, {
    method: "GET",
  });
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const fallback = typeof query.cart_id === "string" ? query.cart_id : null;

  try {
    let cartId = await ensureCartId(event, fallback);

    try {
      const data = await fetchCart(cartId);
      writeCartId(event, cartId);
      return data;
    } catch (error: any) {
      if (!isCartNotFoundError(error)) throw error;

      // A deployment/database change can leave a browser holding a cart UUID
      // that no longer exists. Replace it transparently with a new cart.
      clearCartId(event);
      const created = await createCart(event);
      cartId = created.cart_id;

      if (created?.cart) return created;
      return await fetchCart(cartId);
    }
  } catch (error: any) {
    console.error("Fetch cart proxy error:", error?.data || error);
    return proxyError(error, "Could not fetch the cart");
  }
});
