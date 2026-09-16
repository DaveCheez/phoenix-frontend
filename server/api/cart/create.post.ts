import { defineEventHandler, getCookie, setCookie } from "h3";
import { djangoFetch } from "../../utils/django";
import { proxyError } from "../../utils/proxyError";

export default defineEventHandler(async (event) => {
  const existingCartId = getCookie(event, "cart_id");
  if (existingCartId) {
    return { success: true, cart_id: existingCartId };
  }

  try {
    const data: any = await djangoFetch("cart/create/", {
      method: "POST",
    });

    if (!data?.cart_id) {
      return {
        success: false,
        code: "CART_CREATE_FAILED",
        error: "Django did not return a cart ID",
      };
    }

    setCookie(event, "cart_id", data.cart_id, {
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return data;
  } catch (error: any) {
    console.error("Create cart proxy error:", error?.data || error);
    return proxyError(error, "Could not create a cart");
  }
});
