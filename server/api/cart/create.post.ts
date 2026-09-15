import {
  defineEventHandler,
  getCookie,
  setCookie,
} from "h3";
import { djangoFetch } from "../../utils/django";

export default defineEventHandler(async (event) => {
  const existingCartId = getCookie(event, "cart_id");
  if (existingCartId) {
    return { cart_id: existingCartId };
  }

  const data: any = await djangoFetch("cart/create/", {
    method: "POST",
  });

  if (!data?.cart_id) {
    return { success: false, error: "Django did not return a cart ID" };
  }

  setCookie(event, "cart_id", data.cart_id, {
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { cart_id: data.cart_id };
});
