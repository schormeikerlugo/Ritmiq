---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/api.js
tags: [helper, api, desktop, pwa, ipc, adaptador]
---

# `lib/api.js`

> API client unificado agnóstico de plataforma. En Electron usa `window.ritmiq` (IPC via [[preload]]); en PWA implementa cada método usando LAN server + Supabase directamente. Exporta el singleton `api` y el flag `isDesktop`.

## Ubicación
`packages/ui/src/lib/api.js:1` (385 líneas)

## Exports

```js
export const api: typeof electronApi | typeof webApi
export const isDesktop: boolean   // true si window.ritmiq existe
```

## Patrón del adaptador

```
isElectron = !!window.ritmiq
api = isElectron ? electronApi : webApi
```

Cada método del `api` tiene implementación en ambas rutas. Los stores y hooks llaman a `api.xxx` sin saber si están en Desktop o PWA.

## Inventario de métodos

| Namespace | Desktop | PWA |
|---|---|---|
| `appInfo()` | `window.ritmiq.appInfo()` | `{ lanPort: null }` |
| `ytSearch(q)` | LAN server (1º) → Edge Function | LAN (1º) → Edge |
| `ytSearchAll(q)` | Edge `search-youtube?type=all` | Ídem |
| `ytSearchByType(q, type)` | Ídem | Ídem |
| `ytMetadata(q)` | LAN (1º) → Edge (fallback) | LAN (1º) → Edge |
| `ytStreamUrl(q)` | IPC `yt:streamUrl` | Error (no aplica) |
| `ytdlpInfo()` | IPC | `{ path:null, version:null }` |
| `ytdlpUpdate()` | IPC | Throw |
| `sharedCacheStats/Clear` | IPC | No-op |
| `tunnelStatus/Start/Stop/…` | IPC | No-op / Throw |
| `authToken/Regenerate` | IPC | null |
| `libraryList(uid)` | IPC SQLite | Supabase SELECT |
| `libraryAdd({idOrUrl, userId})` | IPC yt:metadata + SQLite | ytMetadata + Supabase |
| `libraryAddFromMeta({meta, userId})` | IPC | Supabase upsert |
| `libraryDownload(id)` | IPC → disco | IndexedDB (Dexie) |
| `libraryUndownload(id)` | IPC | removeLocal |
| `libraryOnDownloadProgress(cb)` | IPC listener | pubsub interno |
| `librarySyncRemote(track)` | IPC SQLite sync | no-op |
| `libraryDeleteRemote(id)` | IPC | no-op |
| `devices*` | IPC | no-op / Throw |
| `playlists*` | IPC SQLite | no-op (stores usan Supabase directo) |

## Anatomía del código (snippets clave)

### 1. ytSearch PWA: LAN primero por el prewarm
`packages/ui/src/lib/api.js:94-107`

```js
ytSearch: async (q) => {
  // CRÍTICO en PWA móvil: el LAN server hace prewarm de yt-dlp para los
  // primeros resultados, así el play() empieza al instante. Si solo usamos
  // Edge, la primera reproducción tarda 5-10s extra.
  if (getLanBaseUrlSync() || getTunnelUrlSync()) {
    try { return await lanSearch(q); }
    catch (err) {
      console.warn('[api.ytSearch] LAN/Tunnel falló, intentando Edge Function', err);
    }
  }
  return edgeSearch(q);
},
```

**Por qué LAN primero**: el [[lan-server]] hace `resolveCached(it.id, 1)` para los 2 primeros resultados en background. Cuando el usuario clickea play, la URL ya está resuelta → 0ms de espera. La Edge Function no hace prewarm.

### 2. `persistFromMeta`: idempotente con enriquecimiento
`packages/ui/src/lib/api.js:307-364`

```js
async function persistFromMeta(meta, userId) {
  // Buscar existente primero.
  const { data: existing } = await supabase.from('tracks')
    .select('*').eq('user_id', userId).eq('yt_id', meta.id).maybeSingle();
  if (existing) {
    // Enriquecer si le falta artista/álbum (importado antes sin esa info).
    const updates = {};
    if (!existing.artist && (meta.artist || meta.uploader)) updates.artist = ...;
    if (!existing.album && meta.album) updates.album = meta.album;
    if (Object.keys(updates).length > 0) { /* UPDATE + devolver */ }
    return rowToTrack(existing);
  }
  // INSERT nuevo...
  // Race condition handler: 23505 → re-leer el ganador.
  if (String(error.code) === '23505') {
    const { data: again } = await supabase.from('tracks')
      .select('*').eq('user_id', userId).eq('yt_id', meta.id).maybeSingle();
    if (again) return rowToTrack(again);
  }
}
```

**Tres capas de idempotencia**:
1. SELECT antes de INSERT (camino rápido si ya existe).
2. Enriquecimiento de campos faltantes (track importado sin artista → se completa al ser buscado con metadatos completos).
3. Race condition handler 23505 (dos llamadas simultáneas → el segundo re-lee el que ganó).

### 3. `edgeAuthHeaders`: JWT correcto para Edge Functions
`packages/ui/src/lib/api.js:219-227`

```js
async function edgeAuthHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? anonKey;
  return {
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
  };
}
```

**Por qué usar el `access_token` del usuario y no el `anonKey` como Bearer**: con las claves Supabase nuevas (`sb_publishable_*`), la gateway valida el Bearer como JWT y rechaza el formato de la anon key → 401. El access_token del usuario es un JWT válido. La anon key va solo en el header `apikey`.

### 4. PWA `libraryDownload` con pubsub interno
`packages/ui/src/lib/api.js:168-186`

```js
const pwaProgressListeners = new Set();
function pwaEmitProgress(trackId, pct) {
  for (const cb of pwaProgressListeners) { try { cb({ trackId, pct }); } catch {} }
}

// webApi.libraryDownload
libraryDownload: async (trackId) => {
  const t = useLibraryStore.getState().tracks.find(...);
  await downloadTrackToLocal(trackId, (pct) => pwaEmitProgress(trackId, pct), { ytId: t?.ytId });
  return true;
},
libraryOnDownloadProgress: (cb) => {
  pwaProgressListeners.add(cb);
  return () => pwaProgressListeners.delete(cb);
},
```

**Por qué pubsub interno en PWA**: en Desktop, el progreso viene vía IPC del main. En PWA no hay IPC — el progreso se emite desde el mismo proceso. El pubsub replica el contrato del IPC para que [[downloads]] store funcione igual en ambas plataformas.

## Casos de borde

- **`optionalCall`**: si el preload está desactualizado y no expone `librarySyncRemote`, `optionalCall` devuelve un async no-op en lugar de tirar error al llamar `window.ritmiq.library.syncRemote`.
- **`ytMetadata` en PWA sin LAN**: fallback a `edgeSearch(ytId)` y usa el primer resultado. Si el video no aparece en search, lanza `'No se pudo resolver metadata sin LAN'`.
- **`ytStreamUrl` en PWA**: throw inmediato — en PWA la URL del stream se obtiene via `resolveAudioSource` → LAN `/stream/` o Edge `resolve-stream`, nunca via IPC.

## Performance y costes

| Método | Desktop | PWA |
|---|---|---|
| `ytSearch` | LAN server ~800ms (con prewarm) | Ídem si LAN disponible |
| `libraryList` | SQLite ~5ms | Supabase ~200ms |
| `libraryDownload` | IPC yt-dlp 5-30s | LAN /download/ 3-30s |
| `libraryAddFromMeta` | IPC + SQLite ~300ms | Supabase INSERT ~200ms |

## Dependencias entrantes

Prácticamente todos los stores y hooks que realizan operaciones de red: [[library]], [[playlists]], [[downloads]], [[import]], [[artist]], [[use-player]], [[use-radio]].

## Dependencias salientes

- [[lan-client|ui/lib/lan-client]] → `lanSearch`, `lanMetadata`, `getLanBaseUrlSync`, `getTunnelUrlSync`.
- [[local-downloads|ui/lib/local-downloads]] → `downloadTrackToLocal`, `removeLocal`, `getLocalSize`.
- [[supabase|ui/lib/supabase]] → cliente singleton.
- `window.ritmiq` (via [[preload]]) en Desktop.
- [[id|ui/lib/id]] → `randomId`.
- [[url-rewrite|ui/lib/url-rewrite]] → `rewriteHost`.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Desktop usando Edge en lugar de LAN para `ytSearch` | Sin prewarm → primer play tarda 5-10s extra. |
| `edgeAuthHeaders` con anon key como Bearer | 401 en Edge Functions con claves Supabase nuevas. |
| Quitar `optionalCall` wrapper | Si el preload no tiene el método, `window.ritmiq.library.syncRemote` tira `TypeError: not a function` al iniciar. |
| `persistFromMeta` sin handler de 23505 | Race en imports paralelos → error no manejado. |
| `pwaProgressListeners` como array (no Set) | Múltiples registros del mismo listener → callback llamado N veces por evento. |

## Notas / Changelog
- 2026-05-22: nivel pleno. Nota central de F5 — es el adaptador que unifica Desktop y PWA.
