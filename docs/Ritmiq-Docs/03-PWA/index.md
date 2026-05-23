---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: apps/pwa/
tags: [pwa, indice, overview]
---

# `apps/pwa/`

> PWA standalone instalable en iOS y Android. **Reutiliza ~100% de `@ritmiq/ui`** — toda la UI, hooks, stores y helpers son compartidos con el Desktop. Lo específico de la PWA vive en la configuración (`vite.config.js`, `index.html`, manifest) y en el Service Worker (`sw-push.js`).

## Estructura

```
apps/pwa/
├── index.html              Splash images iOS + meta tags + viewport
├── vite.config.js          Vite + VitePWA + manifest + workbox + runtime cache
├── package.json            @ritmiq/ui, /core, /api, /db + dexie
├── src/
│   ├── main.jsx            Bootstrap React + installZoomBlocker
│   └── pages/              (vacío — todas las vistas vienen de @ritmiq/ui)
└── public/
    ├── icon-192.png / icon-512.png / icon-512-maskable.png
    ├── apple-touch-icon.png
    ├── favicon.ico / favicon.svg
    ├── logotipo.png
    ├── sw-push.js          Handlers Web Push + notification click
    └── splash/             8 splash images iOS por device + DPR
```

## Notas relacionadas

- [[main|apps/pwa/src/main.jsx]] — bootstrap React.
- [[manifest-y-service-worker]] — manifest W3C + workbox + runtime cache.
- [[apple-touch-startup]] — splash images iOS y su sistema de media queries.
- [[sw-push]] — Service Worker de Web Push y notification click.

## Por qué la carpeta `pages/` está vacía

La PWA arranca `<App />` de `@ritmiq/ui`, que internamente gestiona el ruteo via [[view]] store (`view.kind`). No hay router de URL ni `pages/*.jsx` específicos.

Las vistas que se muestran (Home, Library, PlaylistView, FriendsView, etc.) viven en `packages/ui/src/components/` y son las **mismas** que ve el Desktop. La diferencia visual entre Desktop y PWA es solo CSS responsive (`@media (max-width: 768px)`) más algunos componentes condicionales como [[BottomNav]] (mobile-only) vs [[Sidebar]] (desktop-only).

## Diferencias funcionales Desktop vs PWA

| Aspecto | Desktop (Electron) | PWA |
|---|---|---|
| Audio backend | [[howler-backend]] (Howler.js) / [[html-audio-backend]] | [[html-audio-backend]] (HTML Audio + WebAudio) |
| Persistencia | SQLite vía [[ipc]] | IndexedDB via [[dexie-adapter]] y [[local-downloads]] |
| Streaming YouTube | yt-dlp embebido vía IPC ([[ipc#yt:streamUrl]]) | LAN server del Desktop / Edge [[resolve-stream]] |
| Descargas offline | Archivo en `<userData>/audio/` | Blob en IndexedDB ([[local-downloads]]) |
| Notificaciones | `electron.Notification` ([[use-desktop-notifications]]) | Web Push API + [[sw-push|sw-push.js]] |
| LAN/Tunnel discovery | mDNS local (siempre disponible) | [[lan-discovery]] + [[tunnel-registry]] vía Supabase |
| Atajos de teclado | [[use-shortcuts]] | No aplica (mobile) |
| Pull-to-refresh | No (overhead innecesario) | [[use-pull-to-refresh]] |
| Wake lock | No (siempre encendido) | [[use-wake-lock]] (cuando NowPlaying está abierto) |

## Build y deploy

```bash
pnpm --filter @ritmiq/pwa dev       # local dev http://192.168.x.x:5173
pnpm --filter @ritmiq/pwa build     # produce apps/pwa/dist/
# Vercel toma dist/ y la sirve (configurado en vercel.json)
```

## Notas / Changelog
- 2026-05-22: nota índice del directorio `apps/pwa/`.
