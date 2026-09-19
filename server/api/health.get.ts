import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  status: "ok",
  service: "phoenix-vanz-frontend",
  backend_configured: Boolean(process.env.NUXT_DJANGO_API_BASE),
}));
