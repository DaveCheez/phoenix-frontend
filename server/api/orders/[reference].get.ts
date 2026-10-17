import { defineEventHandler, getRouterParam } from "h3";

import { beginCart, callDjango } from "../../utils/cartRoute";
import { handleOrderConfirmation } from "../../utils/orderActions";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleOrderConfirmation(
    event,
    started.config,
    (input) => callDjango(event, started.config, input),
    String(getRouterParam(event, "reference") || ""),
  );
});
