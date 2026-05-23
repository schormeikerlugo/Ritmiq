---
tipo: componente
capa: ui
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/SpotifyImportDialog/SpotifyImportDialog.jsx
tags: [componente, import, spotify, dialog, portal]
---

# `SpotifyImportDialog`

> Modal de importación de playlists de Spotify (sin OAuth). Preview → matching en YouTube → persistencia. 2 workers paralelos con progreso por track.

## Ubicación
`packages/ui/src/components/SpotifyImportDialog/SpotifyImportDialog.jsx:1` (615 líneas)

## Props

```js
{ onClose: () => void }
```

Renderizado via `createPortal` en desktop o [[BottomSheet]] en mobile.

## Stores consumidos

| Store | Uso |
|---|---|
| [[import]] store | `loading`, `importing`, `done`, `source`, `items`, `createdPlaylistId`, `preview`, `import`, `reset` |
| [[view]] store | `goPlaylist` |

## Flujo de 3 pasos

```
1. INPUT: usuario pega URL de Spotify
          → preview() → lanSpotifyPlaylist(url) → LAN /spotify/playlist
          → muestra lista de tracks con título/artista

2. MATCHING: import() → 2 workers paralelos
              → ytSearch("artista título Topic")
              → persistByYtId (idempotente, con mutex)
              → cada track muestra: pending → matching → matched → persisted / error

3. DONE: navega a la playlist creada (goPlaylist(createdPlaylistId))
```

## Adaptativo: Desktop vs PWA

- Desktop: renderizado como modal via `createPortal(content, document.body)` con [[use-lock-body-scroll]].
- Mobile/PWA: se adapta a un [[BottomSheet]] si `useMobileViewport()` devuelve true.

## Solo disponible si hay LAN o Desktop

```js
const canImport = isDesktop || getLanBaseUrlSync() || getTunnelUrlSync();
```

El LAN server es necesario para `POST /spotify/playlist`. Sin él, el botón está deshabilitado con mensaje explicativo.

## Notas / Changelog
- 2026-05-22: nivel medio.
