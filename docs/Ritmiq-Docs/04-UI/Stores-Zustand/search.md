---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/search.js
tags: [store, busqueda, youtube]
---

# `stores/search.js`

> Store de búsqueda avanzada multi-tipo (videos, artistas/channels, playlists). Alimenta la vista `SearchView`. El buscador rápido del `TopBar` usa directamente `api.ytSearch`, no este store.

## Ubicación
`packages/ui/src/stores/search.js:1` (70 líneas)

## Estado

```js
{
  query: string,
  videos:    Array<{id, title, uploader?, duration?, thumbnail?}>,
  channels:  Array<{id, title, subscribers?, thumbnail?}>,
  playlists: Array<{id, title, videoCount?, thumbnail?, author?}>,
  loading: boolean,
  error: string | null,
}
```

## Acciones

| Acción | Edge Function | Descripción |
|---|---|---|
| `fetch(q)` | `search-youtube?type=all` | Carga los 3 tipos. Cache de sesión: si query === q actual y hay resultados, no re-fetcha. |
| `fetchMore(type, 20)` | `search-youtube?type=<type>` | Paginación por tipo. Reemplaza el array de ese tipo. |
| `reset()` | — | Vacía todo el estado. |

## Anatomía del código (snippet clave)

### Cache de sesión por query
`packages/ui/src/stores/search.js:33`

```js
if (get().query === query && get().videos.length > 0) return;
```

**Por qué**: si el usuario navega a otro view y vuelve a SearchView con la misma query, no re-llamamos la Edge Function. Los datos ya están en memoria. Si quiere refrescar, debe cambiar la query o llamar `reset()` + `fetch()`.

## Casos de borde

- **Sin resultados**: cada tipo puede venir vacío independientemente (`videos: []` aunque `channels` tenga items).
- **`fetchMore` reemplaza todo el tipo**: no es "append" real — reemplaza los resultados actuales por 20 nuevos. Si el usuario quería ver sus resultados originales, los pierde.
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
- 2026-05-22: nivel simple.
