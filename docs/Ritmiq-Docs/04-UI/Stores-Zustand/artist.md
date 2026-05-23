---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/artist.js
tags: [store, artista, album, edge-function, cache]
---

# `stores/artist.js`

> Store de la página de artista. Mantiene detalles por nombre (Last.fm + Innertube via Edge) y álbumes resueltos. También gestiona el flujo de "Guardar álbum como playlist".

## Ubicación
`packages/ui/src/stores/artist.js:1` (165 líneas)

## Estado

```js
{
  details: Record<string, ArtistPayload | LoadingEntry>,   // key = nombre del artista
  albums:  Record<string, AlbumPayload | LoadingEntry>,    // key = `${artist}::${album}` lowercase
  saves:   Record<string, { saving:boolean, error, progress:number }>, // key = album key
}
```

## Acciones

| Acción | Edge Function | Cache |
|---|---|---|
| `fetch(name)` | `artist-detail` | En memoria por sesión |
| `resolveAlbum(artist, album)` | `album-resolve` | En memoria + server-side 7 días |
| `saveAlbumAsPlaylist({artist, album, coverUrl, tracks})` | — | — |
| `reset()` | — | — |

## Anatomía del código (snippets clave)

### 1. `saveAlbumAsPlaylist`: secuencial para evitar conflictos de yt_id
`packages/ui/src/stores/artist.js:115-142`

```js
// (Serie evita conflictos de unicidad en (user_id, yt_id) cuando el
//  álbum tiene tracks duplicados o si yt-dlp devuelve mismo ytId
//  para distintos títulos.)
for (const t of tracks) {
  try {
    const persisted = await api.libraryAddFromMeta({
      meta: { id: t.ytId, title: t.title, artist, album, ... },
      userId,
    });
    await usePlaylistsStore.getState().addTrack(playlist.id, persisted.id);
  } catch (e) {
    console.warn('[album] persist track failed', t?.title, e?.message);
  }
  done++;
  // update progress...
}
```

**Por qué serie y no paralelo**: si el álbum tiene 2 tracks con el mismo `ytId` (raro pero ocurre con remasters/ediciones), procesarlos en paralelo generaría una race condition de INSERT contra el índice UNIQUE `(user_id, yt_id)`. En serie, el primero inserta y el segundo recibe el track ya existente vía `api.libraryAddFromMeta` que es idempotente.

### 2. `saveAlbumAsPlaylist`: sign-out automático en sesión inválida
`packages/ui/src/stores/playlists.js:104-110` (misma lógica en [[playlists#load]])

```js
// Si falla por FK (auth.users sin la fila), la sesión es inválida
// → sign out automático para que el usuario vuelva a registrarse.
const code = err?.code ?? err?.details ?? '';
if (String(code).includes('23503') || String(err?.message ?? '').includes('foreign key')) {
  await supabase.auth.signOut();
  set({ ..., error: 'Sesión expirada. Vuelve a iniciar sesión.' });
}
```

(La lógica completa de este patrón vive en [[playlists#load]].)

### 3. `callEdge`: helper compartido artista/álbum
`packages/ui/src/stores/artist.js:18-35`

```js
async function callEdge(path, params) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON;
  // Si no hay sesión, usa anon key (edge functions con JWT verification disabled pueden aceptarlo).
  // ...
}
```

**Por qué fallback a `SUPABASE_ANON`**: las Edge Functions de artista/álbum no contienen datos privados del usuario (son datos públicos de Last.fm). Permitir acceso anon reduce la fricción en flows de onboarding donde el usuario aún no se logueó.

## Casos de borde

- **`resolveAlbum` devuelve tracks sin `ytId`**: `api.libraryAddFromMeta` necesita `meta.id` (el ytId). Si el servidor devuelve un track sin ytId, `t.ytId` es null → `id: null` → la Edge Function/IPC falla. `catch` lo absorbe y el track se salta.
- **`saveAlbumAsPlaylist` con tracks vacíos**: retorna null inmediatamente. La UI no debería llamarla con array vacío.
- **`progress: 100` aunque haya errores**: el progreso llega a 100 siempre (aunque algunos tracks fallen); el caller puede leer `saves[key].error` para saber si hubo problemas parciales.

## Dependencias entrantes
- [[ArtistView]] componente → `fetch`, `resolveAlbum`, `saveAlbumAsPlaylist`.
- [[AlbumView]] componente → `resolveAlbum`.

## Dependencias salientes
- [[playlists]] store → `create`, `addTrack`, `setCover`.
- [[library]] store → `load`.
- [[api|ui/lib/api]] → `libraryAddFromMeta`.
- Edge Functions: [[artist-detail]], [[album-resolve]].

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar serial por paralelo en `saveAlbumAsPlaylist` | Race condition en UNIQUE constraint → algunos tracks duplicados, otros fallidos. |
| Quitar fallback a `SUPABASE_ANON` | Usuario no logueado no puede ver página de artista. |

## Notas / Changelog
- 2026-05-22: nivel medio.
