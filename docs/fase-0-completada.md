# Fase 0 — Cerrar deuda comprometida ✓

Esta fase cierra los TODOs y items pendientes documentados en
`docs/share-deeplink-roadmap.md` y `docs/RECOMMENDATIONS.md`, asi como
los marcadores TODO en codigo (`ArtistView.jsx:132`, `SearchView.jsx:389/456`).

Cinco commits atomicos, gate manual despues de cada uno. Build PWA +
AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 0.1 | `feat(share): T4 endpoint /api/mark-installed` | `697ab4f` | Vercel Edge Function setea cookie cross-context iOS. |
| 0.2 | `feat(share): T5 refresh visibilitychange throttle diario` | `e6f0bff` | `pingMarkInstalled()` + listener en App.jsx con throttle 24h. |
| 0.3 | `feat(share): T7 Edge Middleware con Open Graph + Twitter Card` | `2a28bb2` | `apps/pwa/middleware.js` inyecta OG en `/share/track/*` para scrapers. |
| 0.4 | `feat(artist): guardar discografia completa como playlists` | `be78359` | Boton "Guardar discografia" en ArtistView con progreso por toast. |
| 0.5 | `feat(search): abrir playlist completa de YouTube` | `d585e68` | Edge function `yt-playlist-resolve` + nueva vista `YtPlaylistView`. |

## Cambios por area

### Share deep-link (T4 + T5 + T7)
- **T4 cookie iOS**: `apps/pwa/api/mark-installed.js` Vercel Edge Function.
  Cliente (App.jsx, SharedView, share.js helpers) ya estaba listo desde
  commit `3d92fc8` \u2014 solo faltaba el endpoint.
- **T5 refresh visibility**: `pingMarkInstalled({ force? })` en
  `share.js` con throttle de 24h via timestamp en localStorage. Listener
  `visibilitychange` en App.jsx solo se registra si `isStandalonePWA()`.
- **T7 Open Graph SSR**: `apps/pwa/middleware.js` Vercel Edge Middleware
  intercepta `/share/track/:ytId*`, decodifica `?meta=<b64>`, fetchea el
  `index.html` del origen, reemplaza `<title>` e inyecta OG + Twitter
  Card antes de `</head>`. Resultado: WhatsApp/Twitter/iMessage muestran
  preview rica al pegar un share link. cache-control 5min.

### Artist (Fase D)
- `useArtistStore.saveDiscography(name)`: itera albumes en serie, reusa
  caches de `resolveAlbum`, guarda con `saveAlbumAsPlaylist`. Estado de
  progreso en `discographySaves[name]`. Anti doble-click.
- `ArtistView` nuevo boton ghost-outline "Guardar discografia" con
  contador en vivo + ConfirmDialog. Toast permanente durante guardado,
  resumen al final.

### Search playlists YT (Fase B)
- Edge function `yt-playlist-resolve` llama Innertube browse, extrae
  tracks + metadata. Sin cache server-side (se puede agregar despues).
- Nueva vista `YtPlaylistView` paralela a ArtistView/AlbumView con
  header gradient + tracks reproducibles + boton "Guardar en biblioteca".
- View kind nuevo: `ytPlaylist` con `ytPlaylistId` (YouTube id, no UUID).
- Navegacion `goYtPlaylist(id)` desde SearchView.

## Deploy requerido

Algunos cambios solo funcionan en produccion (no en local):

1. **Vercel** (PWA frontend):
   - `apps/pwa/api/mark-installed.js` se autodetecta al deploy.
   - `apps/pwa/middleware.js` se autodetecta si Root Directory del
     project Vercel es `apps/pwa`.
   - Verificar tras deploy: visita `https://ritmiq.app/share/track/<id>?meta=<b64>`
     y revisa con curl que el HTML contiene `<meta property="og:*">`.

2. **Supabase Edge Functions**:
   ```bash
   supabase functions deploy yt-playlist-resolve
   ```
   Sin esto, click en playlist YT del search dispara error 404.

## Verificacion manual por commit

### 0.1 + 0.2 (Safari iOS)
1. PWA standalone abierta \u2192 background \u2192 vuelve \u2192 DevTools muestra
   POST a `/api/mark-installed`.
2. `document.cookie` desde Safari iOS (no PWA) incluye `ritmiq_installed=1`.
3. Abrir `/share/track/...` en Safari iOS \u2192 SharedView muestra
   "Abrir en Ritmiq" (no "Instala Ritmiq").

### 0.3 (scrapers sociales)
1. Pega `https://ritmiq.app/share/track/<id>?meta=<b64>` en WhatsApp Web.
2. Card preview debe mostrar titulo + artista + cover.
3. Facebook OG debugger:
   `https://developers.facebook.com/tools/debug/`.

### 0.4 (discografia)
1. Vista de artista con N albumes \u2192 click "Guardar discografia".
2. ConfirmDialog \u2192 OK \u2192 toast "Guardando 0/N".
3. Boton muestra "Guardando X/N" en vivo. User puede seguir navegando.
4. Al final: toast.success con resumen, o toast.error con lista de
   albumes fallidos.

### 0.5 (playlist YT)
1. Search \u2192 tab Playlists \u2192 click una.
2. `YtPlaylistView` carga con cover, autor, N tracks.
3. "Reproducir" \u2192 primer track suena.
4. "Guardar en biblioteca" \u2192 ConfirmDialog \u2192 toast progreso \u2192
   playlist aparece en sidebar.

## Estado del codigo despues de Fase 0

- TODOs eliminados: `ArtistView.jsx:132`, `SearchView.jsx:389`,
  `SearchView.jsx:456`.
- TODOs restantes (de exploraciones generales, no de roadmap): ver
  output de `grep -rn "TODO" packages/ui/src` antes de Fase 1.
- Lineas netas anadidas: ~700 (mayoria en yt-playlist-resolve +
  YtPlaylistView).

## Siguiente fase

Fase 1 \u2014 Sistema de motion (5 commits):
  1.1 duration + motion tokens
  1.2 install gsap
  1.3 useViewTransition hook
  1.4 transiciones entre vistas top-level
  1.5 stagger entrada HomeRow

Ver `docs/fases-plan-general.md` (proximo) para el plan completo.
