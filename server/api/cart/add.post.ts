import { defineEventHandler } from "h3";

import { handleAdd } from "../../utils/cartActions";
import { beginCart, callDjango } from "../../utils/cartRoute";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleAdd(event, started.config, (input) => callDjango(event, started.config, input));
});
