import { defineEventHandler, deleteCookie } from "h3";

export default defineEventHandler((event) => {
  deleteCookie(event, "cart_id", { path: "/" });
  return { success: true };
});
