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
        // Apple touch startup images \u2014 splash screens iOS PWA.
        // Cada uno se aplica a un device concreto via media query en
        // index.html. Sin includirlos aqui, Vite no los copia a dist/.
        'splash/iphone-se.png',
        'splash/iphone-x.png',
        'splash/iphone-12.png',
        'splash/iphone-14pro.png',
        'splash/iphone-12promax.png',
        'splash/iphone-14promax.png',
        'splash/ipad-air.png',
        'splash/ipad-pro-12.png',
      ],
      manifest: {
        // id explicito recomendado para PWAs publicadas — sin esto iOS y
        // Chrome pueden confundir instancias si start_url cambia. Es la
        // identidad estable de la app a nivel sistema operativo.
        id: '/',
        name: 'Ritmiq',
        short_name: 'Ritmiq',
        description: 'Reproductor de música personal',
        theme_color: '#0a0a0c',
        background_color: '#0a0a0c',
        display: 'standalone',
        orientation: 'portrait',
        // start_url incluye source=pwa para que el server pueda distinguir
        // arranques desde el home screen vs visitas web normales (utiles
        // para analytics y para que la PWA marque "instalada" en su
        // localStorage al primer boot standalone).
        start_url: '/?source=pwa',
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
        // Inyecta handlers de Web Push y notification click en el SW
        // auto-generado por VitePWA. El archivo vive en public/ y se sirve
        // como /sw-push.js junto al sw.js de workbox.
        importScripts: ['/sw-push.js'],
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
