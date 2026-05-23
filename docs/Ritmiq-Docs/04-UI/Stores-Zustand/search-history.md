---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/search-history.js
tags: [store, historial, busqueda, persistencia]
---

# `stores/search-history.js`

> Historial de búsquedas del usuario. Persiste las últimas 8 queries en `localStorage`. LRU: registrar la misma query la mueve al top. Filtra URLs/IDs directos (no son búsquedas semánticas).

## Ubicación
`packages/ui/src/stores/search-history.js:1` (71 líneas)

## Estado

```js
{
  recents: string[]  // ordenadas de más reciente a más antigua, max 8
}
```

## Acciones

| Acción | Descripción |
|---|---|
| `record(query)` | Descarta si < 2 chars o es URL/ID YT. Normaliza (lowercase) para dedup. Mueve al top si ya existe. |
| `remove(query)` | Borra una entrada específica. |
| `clear()` | Vacía el historial. |

## Anatomía del código (snippet clave)

### LRU + dedup por lowercase
`packages/ui/src/stores/search-history.js:51-56`

```js
const norm = q.toLowerCase();
const prev = get().recents;
const filtered = prev.filter((r) => r.toLowerCase() !== norm);
const next = [q, ...filtered].slice(0, MAX);
persist(next);
set({ recents: next });
```

**Por qué lowercase para comparar pero preservar el original**: el usuario que buscó "Red Zeppelin" y luego "red zeppelin" verá el original que prefiera en la UI. El dedup es case-insensitive para que no aparezcan las dos variantes.

### Filtro de URLs/IDs directos
`packages/ui/src/stores/search-history.js:47-50`

```js
if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}|^[\w-]{11}$/.test(q)) {
  return;
}
```

**Por qué**: pegar un link de YouTube en el TopBar no es una búsqueda semántica que valga recordar. El usuario no va a buscar esa URL de nuevo escribiéndola.

## Persistencia

| Clave | Formato |
|---|---|
| `ritmiq.search-history` | `JSON.stringify(string[])` |

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Subir `MAX` a 50 | Dropdown de recents demasiado largo; scroll molesto. |
| Quitar el filtro de URLs | URLs de YouTube aparecen en el historial; confusión visual. |
| Cambiar comparación a case-sensitive | Variantes de capitalización acumulan entradas duplicadas. |

## Notas / Changelog
- 2026-05-22: nivel simple.
