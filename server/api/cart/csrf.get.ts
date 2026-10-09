import { useRuntimeConfig } from "#imports";
import { defineEventHandler } from "h3";

import { guardFailure, handleCsrf } from "../../utils/cartActions";
import { csrfReadAllowed } from "../../utils/cartGuard";
import { markCartResponsePrivate } from "../../utils/cartResponse";
import { beginCart, cartOriginPreview, configurationFailure } from "../../utils/cartRoute";

export default defineEventHandler((event) => {
  markCartResponsePrivate(event);
  const preview = cartOriginPreview(event);
  if (!preview) return configurationFailure(event);
  if (!csrfReadAllowed(event, preview)) return guardFailure(event);
  const started = beginCart(event);
  if (!started.ok) return started.body;
  return handleCsrf(event, started.config, {
    baseUrl: String(useRuntimeConfig(event).djangoApiBase || ""),
  });
});
