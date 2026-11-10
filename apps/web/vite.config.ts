import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: { "/api": "http://127.0.0.1:3101" },
  },
  // Unit tests only; e2e/ is run by Playwright.
  test: { include: ["src/**/*.test.ts"] },
});
