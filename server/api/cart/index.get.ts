import { defineEventHandler } from "h3";

import { handleGet } from "../../utils/cartActions";
import { beginCart, callDjango } from "../../utils/cartRoute";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleGet(event, started.config, (input) => callDjango(event, started.config, input));
});
