import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Pure SPA: Caddy serves index.html for every non-file path.
    adapter: adapter({ fallback: "index.html" }),
    serviceWorker: { register: false },
  },
};
