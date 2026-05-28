---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/TopBar/TopBar.jsx
tags: [componente, topbar, busqueda, dropdown, prewarm]
---

# `TopBar`

> Barra superior con buscador en vivo. Combina resultados de la biblioteca local (instantáneos) con YouTube (debounced 400ms). Prewarm de stream para los 3 primeros resultados. Badge de conectividad y queue.

## Ubicación
`packages/ui/src/components/TopBar/TopBar.jsx:1` (450 líneas)

## Props
Sin props.

## Stores y helpers consumidos

| Fuente | Uso |
|---|---|
| [[player]] store | `setCurrent`, `patch` |
| [[view]] store | `goSearch` |
| [[search-history]] store | `recents`, `record`, `remove`, `clear` |
| [[library]] store | `tracks` (matches locales) |
| [[auth]] store | `user` |
| [[social]] store | `profile` (avatar en el header) |
| [[api]] | `ytSearch` (con LAN → Edge fallback) |
| [[lan-client]] | `prewarmStream`, `checkSharedCache` |
| [[library-search]] | `searchLibraryTracks`, `dedupeByYtId` |
| [[connectivity]] | `onConnectionChange` (badge offline) |
| [[sync-queue]] | `onQueueSizeChange` (badge cola pendiente) |
| [[use-shortcuts]] | `SEARCH_INPUT_ID` (para que `Ctrl+K` haga focus) |

## Comportamiento clave

### Dropdown de búsqueda
```
1. matches locales (instantáneo vía searchLibraryTracks)
2. resultados YouTube (debounce 400ms)
3. dedupeByYtId: saca de YT los que ya están en la biblioteca
4. sortedResults: cached (⚡) primero, luego el resto
```

### Prewarm (precarga de stream URL)
Tras cada búsqueda exitosa en YouTube, lanza `prewarmStream(ytId)` para los 3 primeros resultados en background (prioridad 1). Cuando el usuario clickea play, la URL ya está resuelta → sin espera.

### Cache check
`checkSharedCache(ytIds)` pregunta al LAN server qué tracks ya están en shared_audio → badge ⚡ "Reproducción instantánea" en el dropdown.

### Request ID anti-stale
```js
const reqRef = useRef(0);
// en cada búsqueda:
const id = ++reqRef.current;
const items = await api.ytSearch(q);
if (reqRef.current !== id) return; // respuesta de búsqueda anterior
```
Evita que búsquedas lentas sobreescriban resultados de búsquedas más recientes.

### URL/ID directa
Si el usuario pega una URL de YouTube directamente, reproduce sin búsqueda (la regex `URL_OR_ID_RE` lo detecta).

## Anatomía del código (snippet clave)

### Orden de resultados: cached primero
`packages/ui/src/components/TopBar/TopBar.jsx:54-63`

```js
const sortedResults = useMemo(() => {
  if (cachedSet.size === 0) return results;
  const cached = [];
  const others = [];
  for (const r of results) {
    if (cachedSet.has(r.id)) cached.push(r);
    else others.push(r);
  }
  return [...cached, ...others];
}, [results, cachedSet]);
```

**Por qué**: los tracks en shared_audio del desktop se reproducen instantáneamente (sin yt-dlp). Ponerlos primero maximiza la probabilidad de que el primer resultado sea el más rápido de reproducir.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Sin `reqRef` anti-stale | Búsqueda lenta sobreescribe resultados de búsqueda más reciente → dropdown inconsistente. |
| Sin `dedupeByYtId` | Track ya en biblioteca aparece dos veces (como local y como YouTube). |
| Quitar `SEARCH_INPUT_ID` del input | `Ctrl+K` y `/` no hacen focus en el input. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 3.3): hint visual `<kbd>⌘</kbd><kbd>K</kbd>` (o `Ctrl`/`K` en no-Mac) dentro del search input lado derecho. Visible solo en desktop con input vacío y sin focus. State `searchFocused` + `isMac` memoizado para mostrar símbolo correcto. Commit `57a0647`.
