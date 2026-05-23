---
tipo: componente
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/BottomNav/BottomNav.jsx
tags: [componente, navegacion, mobile, pwa, tabs]
---

# `BottomNav`

> Navegación inferior para mobile (≤768px). 5 tabs: Inicio, Buscar, Biblioteca, Amigos (con badge), Ajustes (con avatar).

## Ubicación
`packages/ui/src/components/BottomNav/BottomNav.jsx:1` (78 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[view]] store | `view`, `goHome`, `goSearchView`, `goLibrary`, `goFriends`, `goSettings` |
| [[auth]] store | `user` |
| [[social]] store | `profile` (avatar), `pendingCount` |

## Tabs

| Tab | Ícono | Activo cuando |
|---|---|---|
| Inicio | `Home` | `view.kind === 'home'` |
| Buscar | `Search` | `view.kind === 'search'` |
| Biblioteca | `Library` | `view.kind === 'library'` |
| Amigos | `Users` + badge | `view.kind === 'friends'` |
| Ajustes | Avatar (si logueado) o `Settings` | `view.kind === 'settings'` |

El tab de Ajustes muestra el avatar del usuario si tiene uno. Badge en Amigos = `incomingRequests.length + inbox no leídos`.

## Visible solo en mobile

`@media (min-width: 769px) { display: none }` — en desktop lo reemplaza [[Sidebar]].

## Notas / Changelog
- 2026-05-22: nivel simple.
