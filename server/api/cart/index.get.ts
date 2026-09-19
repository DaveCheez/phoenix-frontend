import { defineEventHandler, getQuery } from "h3";

import {
  clearCartId,
  createCart,
  ensureCartId,
  isCartNotFoundError,
  writeCartId,
} from "../../utils/cartSession";
import { markCartResponsePrivate } from "../../utils/cartResponse";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  markCartResponsePrivate(event);
  const query = getQuery(event);
  const fallback = typeof query.cart_id === "string" ? query.cart_id : null;

  const fetchCart = async (cartId: string) =>
    await djangoFetch(event, `cart/?cart_id=${encodeURIComponent(cartId)}`, {
      method: "GET",
    });

  try {
    let cartId = await ensureCartId(event, fallback);

    try {
      const data: any = await fetchCart(cartId);
      writeCartId(event, data?.cart?.id || cartId);
      return data;
    } catch (error: any) {
      if (!isCartNotFoundError(error)) throw error;

      clearCartId(event);
      const created = await createCart(event);
      cartId = created.cart_id;
      return created?.cart ? created : await fetchCart(cartId);
    }
  } catch (error: any) {
    console.error("Fetch cart proxy error:", error?.data || error);
    return proxyError(event, error, "Could not fetch the cart");
  }
});
