import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  css: ["@/assets/css/tailwind.css"],

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },

  modules: ["@nuxt/icon"],

  runtimeConfig: {
    // Server-only configuration. Nuxt maps these to NUXT_* environment variables.
    djangoApiBase: "http://127.0.0.1:8000/api",
    googlePlacesApiKey: "",
    googlePlacesPlaceId: "ChIJ8_c21s8Ke0gRA_p2G3v4g3g",

    public: {
      siteUrl: "http://localhost:3000",
      stripePk: "",
    },
  },

  nitro: {
    preset: "node-server",
  },

  compatibilityDate: "2025-03-11",
});
