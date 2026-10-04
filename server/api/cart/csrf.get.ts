import { defineEventHandler } from "h3";

import { handleCsrf } from "../../utils/cartActions";
import { beginCart } from "../../utils/cartRoute";

export default defineEventHandler((event) => {
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleCsrf(event, started.config);
});
