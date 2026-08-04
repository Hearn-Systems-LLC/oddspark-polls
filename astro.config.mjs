// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // Browser proof must represent the product surface, not Astro's local
  // inspection overlay. Production never injects it; keep dev/e2e equivalent.
  devToolbar: {
    enabled: false,
  },
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
    // Use passthrough image service — no Cloudflare Images binding required.
    // Poll media lives in R2 (MEDIA binding) in later stories.
    imageService: "passthrough",
  }),
  vite: {
    ssr: {
      external: ["node:async_hooks"],
    },
  },
});
