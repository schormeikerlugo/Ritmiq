---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/view.js
tags: [store, navegacion, router, historial]
---

# `stores/view.js`

> Estado de navegación de la vista central. Implementa un router de SPA sin URL: un stack de historial `View[]` para soportar botón "atrás". Distingue navegaciones **top-level** (resetean historial) de **exploratorias** (acumulan historial).

## Ubicación
`packages/ui/src/stores/view.js:1` (100 líneas)

## Tipo `View` (discriminated union)

```js
type View =
  | { kind: 'home' }
  | { kind: 'library' }
  | { kind: 'downloads' }
  | { kind: 'settings' }
  | { kind: 'stats' }
  | { kind: 'friends' }
  | { kind: 'profile', userId: string }
  | { kind: 'playlist', playlistId: string }
  | { kind: 'search', query: string }
  | { kind: 'artist', name: string }
  | { kind: 'album', artist: string, album: string }
```

## Estado

```js
{
  view: View,               // vista actual, default: { kind: 'home' }
  history: View[],          // stack para goBack(), max 30 entradas
  queueOpen: boolean,
  sidebarOpen: boolean,     // overlay móvil
  nowPlayingOpen: boolean,  // fullscreen player móvil / panel desktop
  settingsSubview: null | 'account',
}
```

## Acciones

### Navegaciones top-level (resetean historial)

```js
goHome()       goLibrary()     goDownloads()
goSettings()   goAccount()     goStats()
goFriends()    goSearchView()  goPlaylist(playlistId)
```

**Por qué resetean**: desde el sidebar, volver "atrás" al explorador de artistas no tiene sentido. El historial solo sirve dentro de flujos exploratorios.

### Navegaciones exploratorias (acumulan historial)

```js
goSearch(query)        goArtist(name)
goAlbum(artist, album) goProfile(userId)
```

### Atrás / overlays

```js
goBack()                // pop del stack, fallback a home
toggleQueue()           closeQueue()
toggleSidebar()         closeSidebar()
openNowPlaying()        closeNowPlaying()
setSettingsSubview(sub)
```

## Anatomía del código (snippet clave)

### `navigateTo`: no duplicar la misma vista
`packages/ui/src/stores/view.js:30-40`

```js
function navigateTo(set, get, view) {
  const cur = get().view;
  // No empujar al stack si vamos a la misma vista exacta.
  const sameView = JSON.stringify(cur) === JSON.stringify(view);
  if (sameView) {
    set({ view, sidebarOpen: false });
    return;
  }
  const stack = [...get().history, cur].slice(-HISTORY_MAX);
  set({ view, history: stack, sidebarOpen: false });
}
```

**Por qué `JSON.stringify`**: el tipo `View` es un objeto con propiedades primitivas. No hay funciones ni referencias circulares. Serializar y comparar strings es suficiente y no requiere deep-equal library.

**Por qué `HISTORY_MAX = 30`**: sesiones largas donde el usuario navega mucho (search → artist → album → artist → album…) sin nunca ir a home. 30 entradas = suficiente para una sesión normal, sin acumular indefinidamente.

## Casos de borde

- **`goBack` con stack vacío**: va a `home` y vacía el historial. Nunca lanza.
- **`goAccount` → `goSettings`**: ambos van a `{ kind: 'settings' }`. `goAccount` existe por backwards-compat con código anterior.
- **`sidebarOpen: false` en todas las navegaciones**: las navegaciones siempre cierran el sidebar (overlay móvil). Si el user abre un sheet y luego navega, el sheet queda abierto — es responsabilidad de `closeAll()` del [[bottom-sheet]] si hace falta.

## Dependencias entrantes
- [[Sidebar]], [[BottomNav]], [[TopBar]], [[App]] (todos los componentes de navegación).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Top-level navigations que acumulan historial | `goHome` después de explorar lleva a historial acumulado; `goBack` desde Home navega a la vista anterior. |
| Quitar `JSON.stringify` comparison | El mismo `artist` abre una nueva entrada en el historial en cada click. |
| Bajar `HISTORY_MAX` a 5 | Sesiones de exploración largas pierden historial relevante. |

## Notas / Changelog
- 2026-05-22: nivel simple.
