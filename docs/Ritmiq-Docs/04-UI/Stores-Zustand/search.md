---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: packages/ui/src/stores/search.js
tags: [store, busqueda, youtube, persistencia, paginacion]
---

# `stores/search.js`

> Store de búsqueda avanzada multi-tipo (videos, artistas/channels, playlists). Alimenta la vista `SearchView`. El buscador rápido del `TopBar` usa directamente `api.ytSearch`, no este store. **Desde 2026-07-17**: incluye estado de UI persistente (`activeTab`, `scrollTop`) y paginación real (`videosContinuation`, `loadMoreVideos`).

## Ubicación
`packages/ui/src/stores/search.js`

## Estado

```js
{
  query: string,
  videos, channels, playlists,    // resultados por tipo
  known,                          // tracks conocidos en Ritmiq (tracks_global)
  loading: boolean,
  error: string | null,
  // UI persistente (sobrevive a navegar fuera y volver):
  activeTab: 'all'|'videos'|'channels'|'playlists',
  scrollTop: number,
  // Paginación "Ver más":
  videosContinuation: string | null,
  loadingMore: boolean,
  expandedTabs: Set<string>,      // tabs que ya cargaron su versión ampliada
}
```

## Acciones

| Acción | Edge Function | Descripción |
|---|---|---|
| `fetch(q)` | `search-youtube?type=all` | Carga los 3 tipos + `known` + `videosContinuation`. Cache de sesión; resetea paginación. |
| `fetchMore(type)` | `search-youtube?type=<type>&max=30` | Al abrir un tab dedicado, carga versión ampliada (reemplaza). Idempotente por tab (`expandedTabs`). |
| `loadMoreVideos()` | `search-youtube?type=videos&continuation=` | Botón "Ver más": **append** de la siguiente página (dedupe por id). |
| `setActiveTab(tab)` | — | Tab activo persistente. |
| `setScrollTop(y)` | — | Scroll persistente. |
| `reset()` | — | Vacía todo el estado (incluidos tab/scroll/paginación). Solo lo llama el botón limpiar y el logout. |

## Anatomía del código (snippet clave)

### Cache de sesión por query
`packages/ui/src/stores/search.js:33`

```js
if (get().query === query && get().videos.length > 0) return;
```

**Por qué**: si el usuario navega a otro view y vuelve a SearchView con la misma query, no re-llamamos la Edge Function. Los datos ya están en memoria. Si quiere refrescar, debe cambiar la query o llamar `reset()` + `fetch()`.

## Casos de borde

- **Sin resultados**: cada tipo puede venir vacío independientemente (`videos: []` aunque `channels` tenga items).
- **`fetchMore` reemplaza el tipo** (versión ampliada al abrir el tab); **`loadMoreVideos` hace append** con dedupe por id (paginación real).
- **Persistencia**: `fetch` con query distinta resetea paginación; la misma query short-circuita (datos en memoria). El scroll se resetea solo en query nueva (ver [[SearchView]]).
- **Error en `fetch`**: `loading: false` pero `error` setea → la UI debe mostrar mensaje de error.

## Dependencias entrantes
- [[SearchView]] componente.

## Dependencias salientes
- [[api|ui/lib/api]] → `api.ytSearchAll`, `api.ytSearchByType`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar cache de sesión | Cada re-render de SearchView hace fetch → quota de Edge Function se agota rápido. |
| `fetchMore` con append en vez de reemplazo | Lista crece indefinidamente; duplicados si el usuario pagina varios tipos. |

## Notas / Changelog
- 2026-07-17: estado UI persistente (`activeTab`/`scrollTop`); paginación real (`videosContinuation`, `loadMoreVideos` con append+dedupe, `expandedTabs`). Ver [[SearchView]], [[search-youtube]]. Commits `d5ba010`, `9ce7ab5`.
- 2026-05-22: nivel simple.
