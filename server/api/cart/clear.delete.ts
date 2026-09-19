import { defineEventHandler, readBody } from "h3";

import { ensureCartId } from "../../utils/cartSession";
import { markCartResponsePrivate } from "../../utils/cartResponse";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  markCartResponsePrivate(event);
  const body = await readBody<Record<string, any>>(event).catch(() => ({}));

  try {
    const cartId = await ensureCartId(event, body?.cart_id);
    return await djangoFetch(event, "cart/clear/", {
      method: "DELETE",
      body: { cart_id: cartId },
    });
  } catch (error: any) {
    console.error("Clear cart proxy error:", error?.data || error);
    return proxyError(event, error, "Could not clear the cart");
  }
});
