/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'fonts/**/*'],
      workbox: {
        // Precache the app shell + wasm assets so everything runs offline.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        // Map tiles are the only network resource; keep the ones already seen
        // so revisited areas render offline and exports don't re-download.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 14 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Walksnail OSD Studio',
        short_name: 'OSD Studio',
        description:
          'Offline tool to combine Walksnail DVR video with .osd overlay and .srt telemetry.',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
