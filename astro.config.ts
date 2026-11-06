import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const pagesBase = (process.env.PAGES_BASE_PATH || "/").replace(/\/$/, "") || "/";

export default defineConfig({
  base: pagesBase,
  integrations: [react()],
  output: "static",
  i18n: {
    locales: ["en", "no"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["maplibre-gl"],
    },
  },
});
