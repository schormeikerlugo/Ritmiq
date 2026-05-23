---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/history.js
tags: [store, historial, reproduccion, estadisticas, offline]
---

# `stores/history.js`

> Store del historial de reproducción. Registra eventos, persiste en Supabase, los encola offline si no hay red, y expone selectores derivados: `recentTracks`, `topTracks`, `topArtists`, `continueListening`, `statsForPeriod`.

## Ubicación
`packages/ui/src/stores/history.js:1` (388 líneas)

## Diseño clave: eventos con snapshot propio

```js
/**
 * @typedef {Object} HistoryEvent
 * @property {string|null} ytId
 * @property {string|null} trackId
 * @property {string}      title     — snapshot propio
 * @property {string|null} artist    — snapshot propio
 * @property {string|null} coverUrl  — snapshot propio
 * @property {number|null} durationSeconds
 * @property {number|null} durationPlayedSeconds
 * @property {string}      playedAt
 * @property {string|null} source
 */
```

**Por qué snapshot y no FK a tracks**: tracks efímeros (`yt:<id>`) nunca se persisten en la biblioteca. Sin snapshot, su historial tendría datos nulos (`title: null`, `artist: null`). Con snapshot, la Home muestra las portadas y títulos correctamente aunque el track no esté en la biblioteca.

## Estado

```js
{
  events: HistoryEvent[],  // descendente por playedAt, max 500
  loading: boolean,
  error: string | null,
  _recentlyRecorded: Map<string, number>,  // fp → timestamp, para dedup 60s
}
```

## Acciones principales

| Acción | Descripción |
|---|---|
| `load()` | Flush offline → pull desde Supabase (500 eventos). |
| `record(track, playedSeconds)` | Registra play con dedup 60s. Optimistic + offline queue. |
| `flushOffline()` | Reintenta enviar eventos encolados offline. |
| `reset()` | Vacía todo. |

## Selectores exportados (puros)

```js
selectRecentTracks(events, limit=20): TrackLike[]
selectTopTracks(events, { days=30, limit=15 }): TrackLike[]
selectTopArtists(events, { days=30, limit=10 }): { artist, coverUrl, playCount, seedTrack }[]
selectContinueListening(events, { limit=8 }): TrackLike[]
selectStatsForPeriod(events, { days=30, topLimit=5 }): StatsObject
```

Son **funciones puras** (no hooks), importadas por componentes para mostrar la Home y la vista de Stats.

## Anatomía del código (snippets clave)

### 1. `record()`: dedup por fingerprint en ventana de 60s
`packages/ui/src/stores/history.js:91-131`

```js
async record(track, playedSeconds) {
  const fp = track.ytId || track.id;
  const now = Date.now();
  const recent = get()._recentlyRecorded;
  // Limpieza ligera de entradas viejas.
  for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  if (recent.has(fp)) return;
  recent.set(fp, now);

  const ephemeral = isEphemeralId(track.id);
  const event = {
    ytId: track.ytId ?? null,
    trackId: ephemeral ? null : (track.id ?? null),
    // ...snapshot...
  };

  // Optimistic: añadir al state inmediatamente.
  set((s) => ({ events: [event, ...s.events].slice(0, HISTORY_LIMIT) }));

  // Persistir en Supabase, encolando si falla.
  try {
    const { error } = await supabase.from('play_history').insert(row);
    if (error) throw error;
  } catch (err) {
    await pushOfflineQueue(event);
  }
}
```

**Por qué 60s**: si el usuario repite una canción manualmente 5 veces seguidas, no queremos 5 entradas en el historial de la misma sesión. 60s es tiempo suficiente para que una escucha "cuente". Después de 60s, una segunda escucha sí es intencional.

**Por qué Map en lugar de Set**: necesitamos el timestamp para hacer el cleanup. Un Set no tiene valores asociados.

### 2. `eventToRow`: validación UUID antes de enviar a Postgres
`packages/ui/src/stores/history.js:178-194`

```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eventToRow(e, userId) {
  const isValidUuid = typeof e.trackId === 'string' && UUID_RE.test(e.trackId);
  return {
    track_id: isValidUuid ? e.trackId : null,
    yt_id:    e.ytId ?? null,
    // ...
  };
}
```

**Por qué validar UUID**: Postgres rechaza con `invalid input syntax for type uuid` si `track_id` no es un UUID válido. Algunos tracks viejos o de flujos sociales pueden tener `id = ytId raw` (ej. `'zG-hiBaCk0I'`). Validar aquí previene errores 400 en el insert. Si no es UUID válido → `null` → el evento se guarda sin FK, pero con `yt_id` como referencia.

### 3. `selectContinueListening`: heurística de "track no terminado"
`packages/ui/src/stores/history.js:353-367`

```js
export function selectContinueListening(events, { limit = 8 } = {}) {
  const seen = new Set();
  for (const e of events) {
    const fp = e.ytId || e.trackId;
    if (!fp || seen.has(fp)) continue;
    if (!e.durationSeconds || !e.durationPlayedSeconds) continue;
    if (e.durationPlayedSeconds >= e.durationSeconds * 0.8) continue; // "terminado"
    if (e.durationPlayedSeconds < 30) continue;  // muy pronto, no es "continúa"
    seen.add(fp);
    out.push(eventToTrackLike(e));
  }
}
```

**El threshold 80%**: si escuchaste ≥ 80% del track, se considera "terminado". Si escuchaste entre 30s y 80%, se considera "en progreso" → aparece en "Seguir escuchando". Menos de 30s = probablemente lo saltaste sin interés.

**Por qué el `seen Set`**: tomar solo el evento más reciente de cada fingerprint (el array ya viene descendente por `playedAt`). Si escuchaste un track 3 veces y la última lo terminaste, no debe aparecer en "Continúa".

### 4. `selectStatsForPeriod`: racha de días activos
`packages/ui/src/stores/history.js:325-347`

```js
// Racha consecutiva: días seguidos con al menos 1 play, contando hacia atrás desde hoy.
let streak = 0;
const today = new Date();
for (let i = 0; i < days; i++) {
  const d = new Date(today.getTime() - i * 86400_000);
  const iso = d.toISOString().slice(0, 10);
  if (dayMap.has(iso)) streak++;
  else if (i > 0) break;  // no contar el gap del pasado
}
```

**Por qué `else if (i > 0)`**: si HOY no hay plays (i=0), la racha sigue siendo válida si ayer (i=1) tuvo plays. La racha se rompe en el primer gap que NO sea hoy.

## Casos de borde

- **`load()` sin sesión**: setea `events: [], loading: false`. No hay error.
- **`flushOffline()` con Supabase caído**: falla silenciosamente (`console.info`). Los eventos siguen en la cola offline de IndexedDB para el próximo intento.
- **Tracks de radio (ids tipo `yt:<id>`)**: `isEphemeralId` devuelve true → `trackId: null` en el evento. El historial los guarda por `ytId`, lo que es suficiente para reconstruirlos como `eventToTrackLike`.
- **`_recentlyRecorded` se resetea en `reset()`**: al cambiar de usuario, la ventana de dedup del usuario anterior no afecta al nuevo.

## Performance

`selectStatsForPeriod` con 500 eventos corre en < 1ms (iterar 500 objetos con operaciones simples). No necesita memoización para ese volumen.

## Dependencias entrantes
- [[use-player]] hook → `record(track, playedSeconds)` tras el umbral de 30s/30%.
- [[Home]] componente → `selectRecentTracks`, `selectTopTracks`, `selectTopArtists`, `selectContinueListening`.
- [[StatsView]] componente → `selectStatsForPeriod`.
- [[App]] → `load` al iniciar.

## Dependencias salientes
- [[supabase|ui/lib/supabase]] → SELECT/INSERT `play_history`.
- [[local-downloads|ui/lib/local-downloads]] → `localDb.table('pendingPlays')` para offline queue.
- [[track-helpers|ui/lib/track-helpers]] → `isEphemeralId`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Snapshot sin `title`/`artist` | Tracks efímeros en historial muestran "Desconocido" y sin cover. |
| `record()` sin dedup 60s | 5 escuchas seguidas = 5 entradas = `topTracks` inflado. |
| `eventToRow` sin validar UUID | Postgres rechaza con 400 → eventos de tracks con id=ytId se pierden. |
| `selectContinueListening` sin umbral 30s | Tracks saltados en 5 segundos aparecen en "Seguir escuchando". |

## Notas / Changelog
- 2026-05-22: nivel pleno.
