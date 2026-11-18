import { defineEventHandler } from "h3";

import { beginCart, callDjango } from "../../utils/cartRoute";
import { handleOrderList } from "../../utils/orderActions";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleOrderList(event, started.config, (input) => callDjango(event, started.config, input));
});
