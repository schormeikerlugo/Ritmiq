---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-28
archivo: apps/pwa/vite.config.js
tags: [pwa, manifest, service-worker, workbox, vite, runtime-cache]
---

# `vite.config.js` — manifest + Service Worker

> Configuración de Vite + VitePWA. Define el manifest W3C, los recursos a precachear, las reglas de runtime cache y la inyección del SW de push.

## Ubicación
`apps/pwa/vite.config.js:1` (119 líneas)

## Manifest W3C

```js
manifest: {
  id: '/',                            // identidad estable
  name: 'Ritmiq',
  short_name: 'Ritmiq',
  description: 'Reproductor de música personal',
  theme_color: '#0a0a0c',
  background_color: '#0a0a0c',
  display: 'standalone',
  orientation: 'portrait',
  start_url: '/?source=pwa',
  scope: '/',
  icons: [192, 512, 512-maskable, 180-apple],
}
```

### Por qué `id: '/'` explícito

Sin `id`, iOS y Chrome pueden confundir instancias si `start_url` cambia entre versiones. El `id` es la identidad estable de la app a nivel sistema operativo. Se establece una sola vez; cambiarlo crea una "app nueva".

### Por qué `?source=pwa` en `start_url`

Permite al server distinguir arranques desde el home screen vs visitas web normales (analytics, "marcar instalada" en localStorage al primer boot standalone). Ver [[share#markPwaInstalled]].

## Workbox configuration

### Precache

```js
globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']
```

Todo el bundle estático se precachea para soporte offline completo del shell de la app.

### Fallback de navegación

```js
navigateFallback: '/index.html'
navigateFallbackDenylist: [/\/stream\//, /\.trycloudflare\.com/, /\.cfargotunnel\.com/]
```

**Crítico**: el SW NO debe interceptar peticiones de audio. Los `<audio>` con Range requests fallan si el SW devuelve cuerpos completos, y en iOS eso suspende la reproducción en background.

### Runtime cache (5 reglas)

| Pattern | Handler | Razón |
|---|---|---|
| `*.supabase.co/storage/*` | `CacheFirst` (500 entries, 30 días) | Carátulas estables — cache agresivo |
| `/stream/*` | `NetworkOnly` | Range requests del `<audio>` |
| `*.trycloudflare.com/*` | `NetworkOnly` | Streaming via Quick Tunnel |
| `*.cfargotunnel.com/*` | `NetworkOnly` | Streaming via Named Tunnel |
| `/functions/v1/resolve-stream` | `NetworkOnly` | Edge Function: URL temporal, no cachear |
| `http://127.0.0.1:*/` | `NetworkOnly` | Supabase local en dev — evitar mezcla con HTTPS productivo |

## Inyección del SW de Push

```js
importScripts: ['/sw-push.js']
```

Hace que el SW auto-generado por workbox cargue [[sw-push]] al iniciar. Sin esto, los handlers de `push` y `notificationclick` no se registrarían.

## Configuración del dev server

```js
server: {
  port: 5173,
  host: true,         // expone 0.0.0.0 para que el iPhone en LAN llegue
  strictPort: true,
}
```

`host: true` es lo que permite probar la PWA en el iPhone conectado a la misma WiFi durante desarrollo.

## Configuración de build

```js
build: {
  chunkSizeWarningLimit: 1000,
}
```

El bundle actual es ~850 KB (251 KB gzip). Code-splitting agresivo a nivel ruta rompería el flow de navegación SPA — todas las vistas (Home, Library, PlaylistView, etc.) son parte del shell. Cuando supere 1100 KB se podrá splittear rutas menos frecuentes (Stats, Friends).

## envDir

```js
envDir: resolve(process.cwd(), '../..')
```

Lee variables `.env*` desde la raíz del monorepo (`/home/.../Ritmiq/.env.production`), no desde `apps/pwa/`. Permite que todos los workspaces compartan el mismo `.env`.

## Dependencias

- `vite-plugin-pwa` (workbox + manifest generation).
- `@vitejs/plugin-react`.

## Notas / Changelog
- 2026-05-22: nivel medio.
- 2026-05-28 (Fase 7.3): añadidas 2 reglas `runtimeCaching` para covers de YouTube y Last.fm:
  - `ritmiq-yt-covers` CacheFirst para `^https://i[0-9]*\\.ytimg\\.com/.*`, LRU 1000 / 30d.
  - `ritmiq-artist-covers` CacheFirst para `^https://lastfm\\.freetls\\.fastly\\.net/.*`, LRU 300 / 30d.
  - `cacheableResponse: { statuses: [0, 200] }` para aceptar respuestas opaque (cross-origin sin CORS headers, así viene YouTube).
  Reduce ~50-80 KB por scroll completo del Home en visitas posteriores. Commit `f90a241`.
- 2026-05-28 (Fase 7.1+7.2): Workbox precachea automáticamente los 13 chunks lazy generados por React.lazy → `precache` final 67 entries / ~2320 KB. La 2da sesión del user, todos los chunks ya están en cache (navegar a Settings es instantáneo). Ver [[Code-Splitting]] para el catálogo completo.
- 2026-05-31: `registerType` cambiado de `autoUpdate` a **`prompt`** + `cleanupOutdatedCaches: true`. El registro del SW y el flujo de actualización in-app (toast "Actualizar" + auto-check 24h + control de versión) están documentados en [[Actualizaciones]]. Las descargas (IndexedDB) NO se borran al actualizar. Ver [[Decisiones-Tecnicas-ADR|ADR-021]].
