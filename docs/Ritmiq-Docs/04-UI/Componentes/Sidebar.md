---
tipo: componente
capa: ui
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Sidebar/Sidebar.jsx
tags: [componente, sidebar, navegacion, desktop]
---

# `Sidebar`

> Navegación lateral desktop. Links top-level (Inicio, Biblioteca, Descargas, Amigos, Ajustes) + lista de playlists con "Favoritas" siempre primero.

## Ubicación
`packages/ui/src/components/Sidebar/Sidebar.jsx:1` (386 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[playlists]] store | `playlists`, `favoritesId` |
| [[view]] store | `view`, `goHome`, `goLibrary`, `goDownloads`, `goSettings`, `goFriends`, `goPlaylist` |
| [[social]] store | `incomingRequests.length + inbox no leídos` → badge en tab Amigos |

## Comportamiento clave

- **Favoritas primero**: sort explícito `if (a.id === favoritesId) return -1`.
- **Badge de amigos**: `pendingCount` derivado de `incomingRequests.length + inbox.filter(i => !i.readAt).length`. Mismo cálculo que [[BottomNav]].
- **`data-active`**: cada item tiene `data-active={view.kind === 'xxx'}` → CSS resalta el link activo.
- **Logotipo → Home**: click en el logo navega a `goHome()`, convención estándar.

## Visible solo en desktop

Controlado via CSS: `@media (max-width: 768px) { display: none }`. En mobile, [[BottomNav]] toma su lugar.

## Notas / Changelog
- 2026-05-22: nivel medio.
