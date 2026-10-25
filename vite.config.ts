import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://ngerver1.github.io/Recipe/
const base = process.env.BASE_PATH ?? '/Recipe/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // Never reload on its own: a reload mid-cook would need another tap to re-enable sound.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'recipe-cards.v1.schema.json'],
      manifest: {
        name: 'Recipe Cards',
        short_name: 'Recipes',
        description: 'Cook from step cards, one at a time, with timers.',
        lang: 'en-AU',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f3ee',
        theme_color: '#b4410f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
