import { defineEventHandler } from "h3";

import { beginCart, callDjango } from "../../utils/cartRoute";
import { handleCreateOrder } from "../../utils/orderActions";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleCreateOrder(event, started.config, (input) => callDjango(event, started.config, input));
});
