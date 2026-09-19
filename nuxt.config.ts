import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  devtools: { enabled: false },

  css: ["@/assets/css/tailwind.css"],

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },

  modules: ["@nuxt/icon"],

  runtimeConfig: {
    // Server-only. DigitalOcean should set NUXT_DJANGO_API_BASE at runtime.
    djangoApiBase: "http://127.0.0.1:8000/api",
    googlePlacesApiKey: "",
    googlePlacesPlaceId: "ChIJ8_c21s8Ke0gRA_p2G3v4g3g",

    public: {
      siteUrl: "http://localhost:3000",
      checkoutEnabled: false,
      stripePublishableKey: "",
    },
  },

  nitro: {
    preset: "node-server",
    compressPublicAssets: true,
  },

  routeRules: {
    "/api/cart/**": {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
      },
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: "en-GB" },
      titleTemplate: (titleChunk) =>
        titleChunk ? `${titleChunk} | Phoenix Vanz` : "Phoenix Vanz",
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          name: "description",
          content:
            "Bespoke campervan roof racks, ladders, carriers and fabrication, designed and fitted by Phoenix Vanz in Lancashire.",
        },
      ],
      link: [{ rel: "icon", href: "/favicon.ico" }],
    },
  },

  compatibilityDate: "2025-07-15",
});
