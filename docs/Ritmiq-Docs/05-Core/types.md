---
tipo: modulo
capa: core
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/core/src/types.js
tags: [core, tipos, jsdoc]
---

# `core/types.js`

> Tipos JSDoc compartidos del dominio Ritmiq. No exporta lógica — solo declaraciones `@typedef`. Importado por todos los módulos críticos para IntelliSense y documentación.

## Ubicación
`packages/core/src/types.js:1` (52 líneas)

## Tipos definidos

### `TrackSource`
```js
/** @typedef {'youtube' | 'local'} TrackSource */
```

### `Track`
```js
/**
 * @typedef {Object} Track
 * @property {string}          id              UUID generado localmente (o canónico de Supabase)
 * @property {string}          userId          ID del propietario en Supabase Auth
 * @property {TrackSource}     source          'youtube' | 'local'
 * @property {string|null}     ytId            ID de 11 chars de YouTube si source==='youtube'
 * @property {string}          title
 * @property {string|null}     artist
 * @property {string|null}     album
 * @property {number|null}     durationSeconds
 * @property {string|null}     coverUrl        URL de thumbnail de YouTube o imagen custom
 * @property {string|null}     filePath        Path absoluto en disco (desktop) o null (PWA/cloud)
 * @property {boolean}         isDownloaded    true si existe archivo local válido
 * @property {string}          createdAt       ISO timestamp
 */
```

### `Playlist`
```js
/**
 * @typedef {Object} Playlist
 * @property {string}  id
 * @property {string}  userId
 * @property {string}  name
 * @property {boolean} isOffline   true → "Smart Download": pre-descargar todos sus tracks
 * @property {string}  createdAt
 */
```

### `PlaybackState`
```js
/**
 * @typedef {Object} PlaybackState
 * @property {Track|null}             currentTrack
 * @property {boolean}                isPlaying
 * @property {number}                 positionSeconds
 * @property {number}                 volume           0..1
 * @property {'off'|'one'|'all'}      repeat
 * @property {boolean}                shuffle
 */
```

### `AudioSourceResult`
```js
/**
 * @typedef {Object} AudioSourceResult
 * @property {string} url      URL reproducible: file://, blob:, http:, https:
 * @property {'local-file'|'local-blob'|'lan'|'cloud-stream'} origin
 * @property {number} [expiresAt]  Epoch ms — solo para origin='cloud-stream'
 */
```

## Notas clave sobre los tipos

- `Track.filePath` **solo existe en Desktop**. En PWA siempre es `null`; el audio offline está en IndexedDB como Blob (ver [[dexie-adapter]]).
- `Track.isDownloaded` puede ser `true` con `filePath: null` si hubo una inconsistencia (archivo borrado fuera de la app). [[sqlite-adapter#findSharedAudio]] limpia automáticamente estas filas.
- `AudioSourceResult.expiresAt` solo se propaga para `cloud-stream`. El caller ([[use-player]] / [[html-audio-backend]]) se encarga de refrescar la URL antes de que expire.
- `Playlist.isOffline` activa la descarga automática de todos sus tracks cuando el usuario los agrega. La lógica vive en [[local-downloads]].

## Dependencias entrantes

Todos los módulos con JSDoc tipado importan desde aquí:
- [[player|core/player]], [[queue|core/queue]], [[sync|core/sync]], [[audio-source|core/audio-source]].
- [[sqlite-adapter]], [[dexie-adapter]].
- [[ipc]], [[lan-server]], [[use-player]], stores de UI.

## Dependencias salientes
- Ninguna (solo `export {}` para marcar el archivo como módulo ESM).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Renombrar `ytId` a `youtubeId` | Todos los accesos a `track.ytId` en 10+ archivos devuelven `undefined`. |
| Cambiar `filePath` a obligatorio (quitar `\|null`) | La PWA recibe tracks con `filePath: null` de Supabase → error de tipo en runtime. |
| Añadir campo obligatorio a `Track` sin actualizar `upsertTrack` | La DB no tiene la columna → INSERT falla. |
| Cambiar `repeat` values | [[queue#setRepeat]] y [[player-store]] validan contra estos strings. |

## Notas / Changelog
- 2026-05-22: nivel simple.
