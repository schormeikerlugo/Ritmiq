---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/import.js
tags: [store, import, spotify, youtube, concurrencia]
---

# `stores/import.js`

> Store del flujo de importación de playlists de Spotify (sin OAuth). Gestiona preview → matching en YouTube → persistencia a Supabase. Concurrencia 2 workers con mutex por `yt_id`.

## Ubicación
`packages/ui/src/stores/import.js:1` (232 líneas)

## Flujo

```
URL Spotify → preview() → items[]: title/artist/pending
                        → import() [2 workers paralelos]
                           ├── ytSearch(artist + title + "Topic")
                           ├── matchear → ytId
                           ├── persistByYtId (mutex por yt_id)
                           └── addTrack a playlist destino
```

## Estado

```js
{
  loading: boolean,      // durante preview()
  importing: boolean,    // durante import()
  done: boolean,
  error: string|null,
  source: { name, description, coverUrl } | null,
  items: ImportItem[],
  createdPlaylistId: string | null,
}
```

## Tipo `ImportItem`

```js
{
  title: string, artist: string, durationMs: number,
  status: 'pending'|'matching'|'matched'|'persisted'|'error',
  ytId: string | null,
  trackId: string | null,
  error?: string,
}
```

## Anatomía del código (snippets clave)

### 1. `persistByYtId`: mutex por `yt_id` con coalescing
`packages/ui/src/stores/import.js:96-161`

```js
const persistInflight = new Map();  // módulo-level: compartido entre workers

async function persistByYtId(best) {
  const ytId = best.id;
  const cached = persistInflight.get(ytId);
  if (cached) return cached;  // coalescing: mismo yt_id → misma Promise

  const promise = (async () => {
    // 1. ¿Ya existe en Supabase?
    const { data: existing } = await supabase
      .from('tracks').select('id')
      .eq('user_id', userId).eq('yt_id', ytId).maybeSingle();
    if (existing?.id) {
      if (isDesktop) { /* sync to SQLite */ }
      return existing.id;
    }

    // 2. INSERT nuevo
    const newId = randomId();
    const { error: insErr } = await supabase.from('tracks').insert({ id: newId, yt_id: ytId, ... });
    if (insErr) {
      // Race: otro worker insertó entre nuestro SELECT y nuestro INSERT.
      const isDup = insErr.code === '23505' || /duplicate|unique/i.test(insErr.message ?? '');
      if (!isDup) throw insErr;
      // Re-leer el ganador de la race condition.
      const { data: again } = await supabase.from('tracks').select('id')
        .eq('user_id', userId).eq('yt_id', ytId).maybeSingle();
      return again.id;
    }
    if (isDesktop) { /* sync a SQLite */ }
    return newId;
  })();

  persistInflight.set(ytId, promise);
  promise.finally(() => persistInflight.delete(ytId));
  return promise;
}
```

**Tres niveles de protección contra duplicados**:

1. **`persistInflight` Map**: dos workers del mismo import con el mismo ytId comparten la misma Promise → solo un INSERT intenta.
2. **SELECT antes de INSERT**: si el track ya existía de una sesión anterior, lo reutiliza.
3. **Race condition handler**: si pasaron el SELECT casi simultáneamente desde dos requests distintos (imports diferentes), el segundo INSERT falla con `23505` → re-lee el ganador.

### 2. Workers paralelos con cursor compartido
`packages/ui/src/stores/import.js:183-225`

```js
let cursor = 0;

async function worker() {
  while (cursor < items.length) {
    const idx = cursor++;  // atomic en JS: motor single-threaded
    const item = items[idx];
    // matching + persist + addTrack...
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
```

**Por qué `cursor++` es seguro en JS**: aunque `Promise.all` corre múltiples async functions, JavaScript es single-threaded. El incremento `cursor++` no puede ser interrumpido entre la lectura y la escritura → dos workers nunca toman el mismo índice.

**Por qué "Topic" en la búsqueda**: YouTube tiene canales "Artista - Topic" para música oficial. `"Arctic Monkeys Topic"` retorna el canal oficial con mejor audio y sin covers. El `find` que busca "topic" en el uploader prioriza ese resultado.

## Casos de borde

- **Spotify URL no encontrada / privada**: `lanSpotifyPlaylist` (vía LAN server endpoint `/spotify/playlist`) falla → `error` setea, `items` vacío.
- **Track sin resultado en YouTube**: `results.length === 0` → status `'error'`. El import continúa con los demás.
- **`persistInflight` no se limpia si la Promise rechaza**: `.finally()` limpia incluso en rechazo. Workers siguientes que necesiten el mismo ytId harán un nuevo intento.
- **Playlist de Spotify con 200 tracks, CONCURRENCY = 2**: ~100 pares de requests paralelos en serie → puede tardar 5-10 minutos. El UI muestra barra de progreso por item.

## Dependencias entrantes
- [[SpotifyImportDialog]] componente.

## Dependencias salientes
- [[playlists]] store → `create`, `addTrack`.
- [[library]] store → `load` al terminar.
- [[lan-client|ui/lib/lan-client]] → `lanSpotifyPlaylist` para preview.
- [[api|ui/lib/api]] → `ytSearch`, `libraryAddFromMeta`, `librarySyncRemote`.
- `supabase` → SELECT/INSERT directo en `tracks`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `persistInflight` mutex | Con CONCURRENCY=2, tracks duplicados en Supabase si el álbum tiene canciones repetidas. |
| Quitar el handler de race condition `23505` | Race entre 2 imports simultáneos de la misma playlist → error no manejado. |
| Búsqueda sin sufijo "Topic" | Resultados de covers y versiones no-oficiales → calidad de audio variable. |

## Notas / Changelog
- 2026-05-22: nivel medio.
