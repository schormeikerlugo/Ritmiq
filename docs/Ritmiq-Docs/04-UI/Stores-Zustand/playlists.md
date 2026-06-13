---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-06-13
archivo: packages/ui/src/stores/playlists.js
tags: [store, playlists, favoritas, offline, sync, realtime]
---

# `stores/playlists.js`

> Store de playlists del usuario. Gestiona la colección `playlists[]` y el mapa `contents { playlistId → [trackId] }`. Implementa offline-first, Smart Download (modo offline), toggle de favoritos, y Realtime updates.

## Ubicación
`packages/ui/src/stores/playlists.js:1` (378 líneas)

## Estado

```js
{
  playlists: Playlist[],
  favoritesId: string | null,    // id de la playlist 'Favoritas'
  contents: Record<string, string[]>,  // trackIds por playlistId
  loading: boolean,
  error: string | null,
}
```

## Invariante: playlist "Favoritas"

La playlist `FAVS_NAME = 'Favoritas'` siempre existe. `load()` la crea automáticamente si no existe en Supabase. `favoritesId` es su id.

## Inventario de acciones

| Acción | Offline-first | Descripción |
|---|---|---|
| `load()` | ✓ (Dexie cache) | Carga playlists + contents. Crea Favoritas si falta. |
| `create(name)` | `tryOrQueue` | Crea nueva playlist con UUID local. |
| `rename(id, name)` | `tryOrQueue` | Renombra. |
| `setOffline(id, bool)` | `tryOrQueue` | Toggle Smart Download. |
| `setCover(id, url)` | `tryOrQueue` | Actualiza coverUrl. |
| `remove(id)` | `tryOrQueue` | No permite borrar Favoritas. |
| `addTrack(playlistId, trackId)` | `tryOrQueue` | Idempotente. Si playlist es offline → encola descarga. |
| `addTracks(playlistId, trackIds[])` | `tryOrQueue` | **Lote**. Dedup contra `contents` + entrada; posiciones secuenciales; persiste en paralelo (absorbe 409); **un solo `set` + un toast agregado** (`N añadidas a X`); auto-download batch si offline. |
| `removeTrack(playlistId, trackId)` | `tryOrQueue` | |
| `removeTracks(playlistId, trackIds[])` | `tryOrQueue` | **Lote**. Filtra `contents` una vez; remoto en paralelo; un `set` + un toast agregado. |
| `reorder(playlistId, orderedIds)` | Optimistic | Drag & drop. Rollback en error. |
| `toggleFavorite(trackId)` | — | Add/remove de Favoritas. |
| `toggleFavoriteMany(trackIds[], add)` | — | **Lote**. Delega en `addTracks`/`removeTracks` sobre Favoritas (un toast). |
| `isFavorite(trackId)` | — | Pure selector. |
| `applyRemotePlaylist(ev)` | — | Realtime: playlists. |
| `applyRemotePlaylistTrack(ev)` | — | Realtime: playlist_tracks. |

## Anatomía del código (snippets clave)

### 1. Auto-creación de Favoritas con sign-out en FK inválida
`packages/ui/src/stores/playlists.js:87-113`

```js
let favs = remote.find((p) => p.name === FAVS_NAME);
if (!favs) {
  favs = { id: randomId(), userId, name: FAVS_NAME, ... };
  try {
    await pushPlaylist(favs);
    if (isDesktop) await api.playlistsUpsert(favs);
    remote.unshift(favs);
  } catch (err) {
    // Si falla por FK (auth.users sin la fila), la sesión es inválida
    // → sign out automático.
    const code = err?.code ?? err?.details ?? '';
    if (String(code).includes('23503') || /foreign key/.test(err?.message ?? '')) {
      await supabase.auth.signOut();
      set({ ..., error: 'Sesión expirada. Vuelve a iniciar sesión.' });
      return;
    }
    throw err;
  }
}
```

**Por qué sign-out automático en FK 23503**: si el INSERT de Favoritas falla por `foreign key violation` contra `auth.users`, significa que el `user_id` en el token ya no existe en la DB (típico tras `supabase db reset`). Seguir con esa sesión generaría errores en cascada en todas las operaciones. El sign-out forzado es más limpio que mostrar errores crípticos.

### 2. `addTrack`: absorción de race condition entre workers paralelos
`packages/ui/src/stores/playlists.js:202-213`

```js
try {
  await tryOrQueue(() => pushPlaylistTrack(playlistId, trackId, position), ...);
} catch (err) {
  // 409 (duplicate / FK race entre workers paralelos de import.js).
  const msg = String(err?.message ?? err ?? '');
  if (!msg.match(/duplicate|conflict|409/i)) throw err;
  // Si el track ya estaba → no-op silencioso.
}
```

**Por qué absorber 409**: el store [[import]] corre 2 workers en paralelo que llaman `addTrack` para el mismo `playlistId`. Si los dos workers añaden el mismo track (por coalescing fallido o race en `persistInflight`), el segundo recibe 409 de Supabase. Es un no-op legítimo.

### 3. `reorder`: optimistic update con rollback
`packages/ui/src/stores/playlists.js:250-268`

```js
async reorder(playlistId, orderedTrackIds) {
  // Optimistic: actualiza la UI inmediatamente
  set((s) => ({ contents: { ...s.contents, [playlistId]: orderedTrackIds.slice() } }));
  try {
    if (isDesktop) await api.playlistsReorder(...)
    await tryOrQueue(() => reorderPlaylistRemote(...), ...);
  } catch (err) {
    console.error('[reorder] failed', err);
    // Rollback: re-leer desde Supabase
    const fresh = await pullPlaylistContents();
    set({ contents: fresh });
  }
},
```

**Por qué optimistic**: el drag & drop debe verse instantáneo. Si esperáramos la respuesta del servidor, el usuario vería el elemento "rebotar" de vuelta a su posición original mientras espera. En caso de error (sin red), el rollback restaura el orden canonical.

### 4. Smart Download al añadir track
`packages/ui/src/stores/playlists.js:222-228`

```js
const pl = get().playlists.find((p) => p.id === playlistId);
if (pl?.isOffline) {
  enqueueOfflineDownload(trackId);
}
```

**Por qué aquí y no en el componente**: el Smart Download debe activarse tanto cuando el usuario añade manualmente como cuando Realtime trae un track añadido desde otro dispositivo. Centralizarlo en `addTrack` (y en `applyRemotePlaylistTrack`) lo cubre ambos caminos.

### 5. `applyRemotePlaylistTrack`: posición correcta del INSERT
`packages/ui/src/stores/playlists.js:346-354`

```js
const { playlist_id: pid, track_id: tid, position } = row;
set((s) => {
  const cur = s.contents[pid] ?? [];
  const without = cur.filter((id) => id !== tid);
  const idx = Math.max(0, Math.min(position ?? without.length, without.length));
  const next = [...without.slice(0, idx), tid, ...without.slice(idx)];
  return { contents: { ...s.contents, [pid]: next } };
});
```

**Por qué insertar en `position` y no al final**: si el usuario en otro dispositivo insertó un track en el medio (posición 3 de 10), el Realtime event trae `position: 3`. Insertarlo al final daría el orden incorrecto. El código primero quita el track si ya estaba (re-insert con nueva posición) y luego lo inserta en la posición indicada.

## Casos de borde

- **`remove('Favoritas')`**: throw `'No se puede borrar Favoritas'`. Guard explícito.
- **`applyRemotePlaylist` DELETE de Favoritas**: `favoritesId` se resetea a null → `isFavorite` siempre devuelve false hasta el próximo `load()`.
- **`load()` sin red**: usa cache de Dexie (PWA) o simplemente `loading: false` sin cambiar el estado (Desktop). El usuario ve los datos de la sesión anterior.
- **`tryOrQueue` falla en remoto**: la op queda en la cola offline del [[sync|core/sync]] → se aplica cuando vuelve la red. El estado local ya está actualizado (optimistic).

## Dependencias entrantes
- [[PlaylistView]], [[Library]] componentes.
- [[artist]] store → `create`, `addTrack`, `setCover`.
- [[import]] store → `create`, `addTrack`.
- [[use-social-realtime]] hook → `applyRemotePlaylist`, `applyRemotePlaylistTrack`.
- [[App]] → `load` al iniciar.

## Dependencias salientes
- [[library]] store, [[downloads]] store.
- [[api|ui/lib/api]], [[sync|ui/lib/sync]], [[sync-queue|ui/lib/sync-queue]].
- [[local-downloads|ui/lib/local-downloads]] → cache PWA.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar sign-out en FK 23503 | Sesión inválida → errores crípticos en todas las operaciones; usuario atrapado. |
| `reorder` sin optimistic update | Drag & drop con "rebote" visual de ~500ms en cada movimiento. |
| Smart Download solo en `addTrack` sin `applyRemotePlaylistTrack` | Tracks añadidos desde otro dispositivo a una playlist offline no se descargan automáticamente. |
| `applyRemotePlaylistTrack` insertando al final | Tracks de otros dispositivos aparecen al final aunque se añadieran en el medio. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-06-13 (selección múltiple): añadidas acciones plurales `addTracks`, `removeTracks`, `toggleFavoriteMany` para operar sobre N tracks con **un solo `set` de estado y un único toast agregado** (en vez de N toasts y N renders al iterar las variantes singulares). Consumidas por [[PlaylistView]], [[Library]] (filtro Descargados) y [[SaveDialog]] (modo multi-track). Ver [[Decisiones-Tecnicas-ADR|ADR-030]].
