---
tipo: moc
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
tags: [moc, pwa]
---

# MOC — PWA

Ruta en repo: `apps/pwa/`

PWA standalone que **reutiliza ~100% de `@ritmiq/ui`** (mismas vistas, hooks y stores que el Desktop). Lo específico de la PWA vive en configuración, Service Worker y splash images.

## Notas de esta carpeta

- [[index|03-PWA/index]] — overview del directorio y diferencias funcionales Desktop vs PWA.
- [[main|03-PWA/main]] — bootstrap React (`src/main.jsx`).
- [[manifest-y-service-worker]] — `vite.config.js` con manifest W3C + workbox + runtime cache.
- [[sw-push]] — handlers de Web Push y notification click.
- [[apple-touch-startup]] — splash images iOS por device + media queries.

## Dataview (auto-generado)

```dataview
TABLE tipo, estado, ultima-revision
FROM "03-PWA"
WHERE tipo != "moc"
SORT file.name ASC
```

## Diferencias clave vs Desktop

| Aspecto | Desktop | PWA |
|---|---|---|
| Audio backend | [[howler-backend]] / [[html-audio-backend]] | [[html-audio-backend]] |
| DB local | `better-sqlite3` vía [[ipc]] | Dexie (IndexedDB) — [[dexie-adapter]] + [[local-downloads]] |
| Streaming YT | yt-dlp local via [[ipc#yt:streamUrl]] | LAN del Desktop / Edge [[resolve-stream]] |
| Descargas offline | Archivo en `<userData>/audio/` | Blob en IndexedDB |
| Notificaciones | `electron.Notification` | Web Push — [[sw-push]] |
| LAN/Tunnel discovery | mDNS local + [[lan-server]] | [[lan-discovery]] + [[tunnel-registry]] |
| Atajos teclado | [[use-shortcuts]] | — |
| Pull-to-refresh | — | [[use-pull-to-refresh]] |
| Wake lock | — | [[use-wake-lock]] (en NowPlaying) |
| Splash | Icono Electron | 8 PNG iOS via media queries |

## Componentes y hooks específicos PWA

Aunque la UI es compartida, hay componentes que solo se renderizan en PWA (mobile-only):

- [[BottomNav]] — visible solo en `< 768px`.
- [[IOSInstallHint]] — solo iOS Safari sin standalone.
- [[SharedView]] — landing pública del share link.
- [[PullToRefresh]] — indicador del pull.

Hooks específicos PWA: [[use-push]], [[use-badge]], [[use-wake-lock]], [[use-pull-to-refresh]], [[use-mobile-viewport]], [[use-share-reminder]].

## Flujos relevantes

- [[Push-Notifications]] — suscripción, envío, sync iOS.
- [[Sincronizacion-LAN]] — pareo Modelo Y desde la PWA.
- [[Tunnel-Cloudflared]] — auto-reconexión via `tunnel_endpoints` Realtime.
- [[Sincronizacion-Offline]] — Dexie cache + sync-queue al volver online.

## Build y deploy

```bash
pnpm --filter @ritmiq/pwa dev       # http://192.168.x.x:5173
pnpm --filter @ritmiq/pwa build     # → apps/pwa/dist/
# Vercel sirve dist/ (ver vercel.json)
```
