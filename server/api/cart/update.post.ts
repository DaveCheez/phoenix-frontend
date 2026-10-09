import { defineEventHandler } from "h3";

import { handleUpdate } from "../../utils/cartActions";
import { beginCart, callDjango } from "../../utils/cartRoute";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleUpdate(event, started.config, (input) => callDjango(event, started.config, input));
});
