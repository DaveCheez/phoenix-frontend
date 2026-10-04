import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { applyCartCachePolicy } from "../utils/cartCachePolicy";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("beforeResponse", (event) => {
    applyCartCachePolicy(event);
  });
});
