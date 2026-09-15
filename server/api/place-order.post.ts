import { createError, defineEventHandler } from "h3";

/**
 * The uploaded project did not include a server-side order or Stripe
 * PaymentIntent implementation. Fail closed rather than showing customers a
 * false order confirmation.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    statusMessage:
      "Online checkout is not configured. Please contact Phoenix Vanz to order.",
  });
});
