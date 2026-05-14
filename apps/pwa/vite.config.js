import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  envDir: resolve(process.cwd(), '../..'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico', 'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
        'logotipo.png',
      ],
      manifest: {
        name: 'Ritmiq',
        short_name: 'Ritmiq',
        description: 'Reproductor de música personal',
        theme_color: '#0a0a0c',
        background_color: '#0a0a0c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // El Service Worker NUNCA debe interceptar peticiones de audio:
        // los `<audio>` con Range requests rompen si el SW responde con
        // cuerpos completos, y en iOS eso suspende la reproducción en
        // background. Excluimos rutas /stream/, dominios de tunnel y blobs.
        navigateFallbackDenylist: [/\/stream\//, /\.trycloudflare\.com/, /\.cfargotunnel\.com/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ritmiq-covers',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Streaming desde el LAN server / tunnel: bypass total para que
            // Range requests funcionen y el <audio> mantenga la sesión activa.
            urlPattern: /\/stream\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/[a-z0-9-]+\.cfargotunnel\.com\//,
            handler: 'NetworkOnly',
          },
          {
            // Edge Function resolve-stream: nunca cachear.
            urlPattern: /\/functions\/v1\/resolve-stream/,
            handler: 'NetworkOnly',
          },
          {
            // Carátulas de Supabase local (HTTP) — no cacheamos en SW para
            // evitar mezcla con HTTPS productivo. Solo bypass.
            urlPattern: /^http:\/\/127\.0\.0\.1:\d+\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,        // expone 0.0.0.0 para que el iPhone en LAN llegue
    strictPort: true,
  },
});
