import {
  defineEventHandler,
  readBody,
  setResponseHeader,
} from "h3";

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

const ROUTE_VERSION = "stable-v1";

export default defineEventHandler(async (event) => {
  markCartResponsePrivate(event);
  setResponseHeader(event, "X-Phoenix-Cart-Route", ROUTE_VERSION);

  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}));
  const existingCartId = readCartId(event, body?.cart_id);

  if (existingCartId) {
    try {
      const data: any = await djangoFetch(
        event,
        `cart/?cart_id=${encodeURIComponent(existingCartId)}`,
        { method: "GET" },
      );
      const confirmedId = data?.cart?.id || existingCartId;
      writeCartId(event, confirmedId);
      return {
        success: true,
        cart_id: confirmedId,
        cart: data?.cart,
        route_version: ROUTE_VERSION,
      };
    } catch (error: any) {
      if (!isCartNotFoundError(error)) {
        console.error("Validate cart proxy error:", error?.data || error);
        return proxyError(event, error, "Could not validate the cart");
      }
      clearCartId(event);
    }
  }

  try {
    const created = await createCart(event);
    return { ...created, route_version: ROUTE_VERSION };
  } catch (error: any) {
    console.error("Create cart proxy error:", error?.data || error);
    return proxyError(event, error, "Could not create a cart");
  }
});
