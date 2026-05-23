---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/library.js
tags: [store, biblioteca, sync, offline-first, realtime]
---

# `stores/library.js`

> Store de la biblioteca de tracks del usuario. Fuente de verdad UI de todos los tracks. Implementa offline-first (Dexie hydration → Supabase pull), merge Desktop/PWA, Realtime live updates y swap de tracks efímeros.

## Ubicación
`packages/ui/src/stores/library.js:1` (275 líneas)

## Estado

```js
{
  tracks: Track[],   // ordenados por createdAt DESC
  loading: boolean,
  error: string | null,
}
```

## Inventario de acciones

| Acción | Desktop | PWA | Supabase |
|---|---|---|---|
| `load()` | SQLite + remote merge | Dexie cache → pull | ✓ pull |
| `addFromYoutube(idOrUrl)` | IPC + pushTrack | api + pushTrack | ✓ insert |
| `addFromMeta(meta)` | IPC + pushTrack | api + pushTrack | ✓ upsert |
| `persistEphemeral(track)` | IPC + pushTrack | api + pushTrack | ✓ upsert |
| `remove(trackId)` | tryOrQueue + IPC | tryOrQueue | ✓ delete |
| `download(trackId)` | → downloads store | → downloads store | — |
| `undownload(trackId)` | IPC + reload | IPC/api + reload | — |
| `applyRemote(event)` | ✓ + IPC sync | ✓ | Realtime push |
| `reset()` | — | — | — |

## Anatomía del código (snippets clave)

### 1. `load()`: offline-first con tres caminos
`packages/ui/src/stores/library.js:20-93`

```js
async load() {
  // PWA: hidratar PRIMERO desde Dexie (respuesta instantánea, offline-first)
  if (!isDesktop) {
    const cached = await getCachedTracks();
    if (cached.length > 0) {
      const localIds = await listLocalIds();
      set({ tracks: cached.map((t) => ({ ...t, isDownloaded: localIds.has(t.id) })) });
    }
  }

  // Pull desde Supabase. Si falla → nos quedamos con la caché.
  let remote;
  try { remote = await pullTracks(); }
  catch (e) {
    console.info('[library] sin red — usando cache local');
    set({ loading: false });
    return;
  }

  // DESKTOP: merge SQLite local (isDownloaded/filePath) + Supabase remoto.
  if (isDesktop) {
    const local = await api.libraryList(userId);
    // Replicar a SQLite tracks remotos que no estén en local.
    for (const r of remote) {
      if (!localById.has(r.id)) {
        try { await api.librarySyncRemote(r); } catch {}
      }
    }
    // Merge: mantener isDownloaded y filePath del local.
    for (const lt of local) {
      const r = byId.get(lt.id);
      if (r) byId.set(lt.id, { ...r, isDownloaded: lt.isDownloaded, filePath: lt.filePath });
    }
  }
  // PWA: is_downloaded viene de IndexedDB (listLocalIds), no de Supabase.
}
```

**Por qué `isDownloaded` no viene de Supabase**: `is_downloaded` es per-device. Supabase no sabe si TÚ descargaste el track en TU dispositivo. En Desktop, SQLite tiene esa información. En PWA, IndexedDB (via `listLocalIds`) tiene qué tracks tienen blob descargado. Supabase solo tiene metadata.

**Por qué replicar remotos a SQLite en Desktop**: si el usuario añadió un track desde la PWA, Supabase lo tiene pero SQLite local no. El [[lan-server]] necesita la fila en SQLite para servir el track cuando la PWA lo pida. Sin replica, el stream fallaría.

### 2. `persistEphemeral`: swap de identidad sin resetear reproducción
`packages/ui/src/stores/library.js:103-147`

```js
async persistEphemeral(track) {
  // ...persist en Supabase → persisted (con UUID real)...

  // Si era el track sonando, swap SIN resetear reproducción.
  const playerState = usePlayerStore.getState();
  const cur = playerState.currentTrack;
  if (cur && cur.id === track.id) {
    const newQueue = playerState.queue.map((t) => (t.id === track.id ? persisted : t));
    playerState.patch({ currentTrack: persisted, queue: newQueue });
  }
  return persisted;
}
```

**El bug que esto resuelve**: antes de este código, `persistEphemeral` llamaba `setCurrent(persisted)` que llama `playNow()` → resetea `isPlaying` y `positionSeconds` → la canción "se pausa y se vuelve a repetir" al guardar en playlist. El `patch` directo sobre `currentTrack` + `queue` cambia la identidad del track sin tocar la reproducción.

### 3. `applyRemote`: Realtime preservando estado local
`packages/ui/src/stores/library.js:220-247`

```js
applyRemote({ eventType, new: row, old }) {
  if (eventType === 'DELETE') {
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
    if (isDesktop) api.libraryDeleteRemote(id).catch(() => {});
    return;
  }
  const incoming = remoteRowToTrack(row);
  set((s) => {
    const idx = s.tracks.findIndex((t) => t.id === incoming.id);
    if (idx >= 0) {
      const cur = s.tracks[idx];
      const next = s.tracks.slice();
      next[idx] = {
        ...incoming,
        isDownloaded: cur.isDownloaded,  // NO sobreescribir con el valor del server
        filePath: cur.filePath,          // NO sobreescribir
      };
      return { tracks: next };
    }
    return { tracks: [incoming, ...s.tracks] };
  });
  if (isDesktop) api.librarySyncRemote(incoming).catch(() => {});
},
```

**Por qué preservar `isDownloaded` y `filePath` del estado local**: Realtime envía el evento del servidor. El servidor no sabe si este dispositivo tiene el archivo descargado. Si sobreescribiéramos con el valor remoto (`is_downloaded: false`), un track descargado aparecería como "no descargado" cada vez que llega un evento Realtime.

## Casos de borde

- **`download()` con import dinámico**: usa `await import('./downloads.js')` para evitar un ciclo de imports `library ↔ downloads`. El ciclo existiría porque `downloads.js` importa `library.js` para obtener la fila completa.
- **`addFromMeta` con yt_id duplicado**: `api.libraryAddFromMeta` es idempotente — devuelve la fila existente. `mergeTrack` la actualiza en el store sin duplicar.
- **`undownload()` llama `load()` completo**: lento pero simple. Alternativa: solo actualizar la fila en el store. No priorizado.

## Performance y costes

| Operación | Coste |
|---|---|
| `load()` desktop | SQLite + Supabase pull + sync de remotos (~500ms-2s) |
| `load()` PWA, primera vez | Dexie read (~50ms) + Supabase pull (~300ms) |
| `load()` PWA, sin red | Solo Dexie (~50ms) |
| `persistEphemeral()` | 1 Supabase insert + 1 IPC sync (~300-500ms) |
| `applyRemote()` | ~1ms (array update) |

## Dependencias entrantes
- [[Library]] componente → `load`.
- [[App]] → `load` al iniciar.
- [[use-social-realtime]] hook → `applyRemote`.
- [[playlists]] store → llama `load` tras cambios que afectan la biblioteca.
- [[downloads]] store → llama `load` tras completar descarga.

## Dependencias salientes
- [[player]] store → `patch` en `persistEphemeral`.
- [[api|ui/lib/api]] → `libraryList`, `librarySyncRemote`, `libraryAddFromMeta`, `libraryDeleteRemote`, etc.
- [[sync|ui/lib/sync]] → `pullTracks`, `pushTrack`, `deleteTrackRemote`.
- [[sync-queue|ui/lib/sync-queue]] → `tryOrQueue`.
- [[local-downloads|ui/lib/local-downloads]] → `listLocalIds`, `getCachedTracks`, `cacheTracks`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `applyRemote` que sobreescribe `isDownloaded` | Track descargado aparece como "online-only" cada vez que Realtime emite. |
| `persistEphemeral` que llama `playNow` en lugar de `patch` | La canción se "pausa y reinicia" al guardar en playlist mientras suena. |
| `load()` sin replicar remotos a SQLite en desktop | Tracks añadidos desde PWA no reproducibles vía LAN hasta próximo arranque. |
| `download()` con import estático de `downloads.js` | Ciclo de importación: `library.js` ↔ `downloads.js` → crash al cargar el módulo. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
