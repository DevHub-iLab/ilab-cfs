// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare(),

  // The Cloudflare adapter otherwise auto-wires Astro's Sessions API to a KV
  // namespace bound as `SESSION`, giving the app a second, competing store of
  // per-visitor state. Better Auth is the only source of truth for identity,
  // so that one is switched off rather than left half-configured.
  session: false,

  vite: {
    optimizeDeps: {
      include: [
        'drizzle-orm',
        'drizzle-orm/sqlite-core',
      ],
      exclude: [
        'better-auth',
      ],
    },
    plugins: [tailwindcss()]
  }
});
