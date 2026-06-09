---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-29
archivo: packages/ui/src/stores/jam.js
tags: [store, zustand, jam, realtime, colaborativo]
---

# `jam` (store)

> Estado del modo Jam (escucha colaborativa). Tres modos: `idle`, `hosting`, `guest`. El host emite comandos a [[jam_sessions]]; los guests los reciben via Realtime CDC y los aplican al player local (vía [[use-jam-sync]]).

## Ubicación
`packages/ui/src/stores/jam.js`

## Estado / Slice
```js
{
  mode: 'idle' | 'hosting' | 'guest',
  session: null | { id, code, hostId },
  participants: [{ user_id, joined_at, last_seen_at }],
  state: { currentTrack, positionSeconds, isPlaying, queue },  // canónico de la sesión
  _channels: [], _heartbeatTimer: null,                         // internos
  createSession(), joinSession(code), leaveSession(),
  hostBroadcast(patch), transferHost(newHostUserId), reset(),
}
```

> `participants[].role` es `'host' | 'guest'` (Bloque 3.2).
> `pendingJoinCode` + `setPendingJoinCode`/`clearPendingJoinCode` para el deep-link
> `/jam/<code>` (Bloque 3.3): [[App|App.jsx]] lo setea al boot y monta el [[JamModal]].
> `jamModalOpen` + `openJamModal`/`closeJamModal`: flag global del modal, usado por el botón
> Jam del [[Player]] (footer desktop). [[App|App.jsx]] monta el modal con
> `pendingJoinCode || jamModalOpen`.

## Anatomía del código (snippets comentados)

### Generación de código con retry de colisión
`packages/ui/src/stores/jam.js:66-79`

```js
for (let attempt = 0; attempt < 5; attempt++) {
  code = makeCode();
  const { data, error } = await supabase.from('jam_sessions').insert({ ... }).select().single();
  if (!error) { inserted = data; break; }
  if (error.code !== '23505') throw error;   // 23505 = unique violation → reintentar
}
```

**Por qué**: el `code` es UNIQUE. Si colisiona (raro: 32^6 combos), reintenta hasta 5 veces.

### hostBroadcast optimista
`packages/ui/src/stores/jam.js:207-217`

```js
// Optimistic local: aplicamos el cambio al state local antes del
// round-trip a Postgres. Mas responsivo.
set((s) => ({ state: { ...s.state, ...patch } }));
await supabase.from('jam_sessions').update(payload).eq('id', session.id);
```

**Por qué**: el host no espera el round-trip a Postgres para ver su propio cambio. Los guests sí esperan el CDC.

### Subscribe: guests aplican, hosts ignoran
`packages/ui/src/stores/jam.js:236-247`

```js
// Solo aplicar para guests; el host ya aplico optimistically.
if (get().mode === 'guest') {
  set({ state: { currentTrack: row.current_track, ... } });
}
```

**Por qué**: evita un doble-set en el host (optimista + CDC echo).

### Cleanup antes de queries en leave
`packages/ui/src/stores/jam.js:159-167`

```js
// Cleanup channels + heartbeat ANTES de las queries para que los
// updates de los otros no causen un re-render con state stale.
for (const ch of _channels) { await supabase.removeChannel(ch); }
if (_heartbeatTimer) clearInterval(_heartbeatTimer);
```

**Por qué**: si se desuscribe después de las queries, podría llegar un CDC tardío y revivir state ya limpiado.

### transferHost: pasar el control (Bloque 3.2)
`packages/ui/src/stores/jam.js`

```js
const { error } = await supabase.rpc('jam_transfer_host', {
  p_session_id: session.id, p_new_host_id: newHostUserId,
});
// Optimista: el ex-host pasa a guest localmente. El CDC confirmara.
set({ mode: 'guest', session: { ...session, hostId: newHostUserId } });
```

**Por qué**: el RPC reasigna `host_id` server-side; el subscribe de UPDATE detecta el cambio
de `host_id` y recalcula el `mode` de **cada** cliente (el nuevo host pasa a `hosting`).

## Side-effects
- DB: CRUD en [[jam_sessions]] + [[jam_participants]] + RPC `jam_transfer_host`.
- Realtime: 2 canales (`jam:<id>`, `jam-participants:<id>`).
- Timer: heartbeat `setInterval` 30s.

## Casos de borde y gotchas
- **Join como host**: si el code es de una sesión propia, `mode='hosting'` (no guest).
- **Host DELETE → guests auto-leave**: el subscribe escucha DELETE y llama `leaveSession()` en guests.
- **Guest no puede emitir**: `hostBroadcast` retorna temprano si `mode !== 'hosting'`; además RLS rechaza.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| No limpiar `_channels` en leave/reset | Memory leak + updates fantasma tras salir. |
| Cambiar el nombre del canal `jam:<id>` | Sin coordinación, guests y host escuchan canales distintos → sin sync. |

## Dependencias salientes
- [[supabase]], [[jam_sessions]], [[jam_participants]].

## Dependencias entrantes
- [[JamModal]] (UI), [[use-jam-sync]] (bridge al player).

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8.1).
- 2026-05-29: `transferHost` + `role` en participants + recálculo de mode en subscribe (Bloque 3.2).
- 2026-05-31 (**fix crítico**): crear/unirse a un Jam lanzaba `Cannot read properties of
  undefined (reading 'user')`. Las 5 lecturas de usuario usaban el patrón roto
  `const { data: { user } } = await supabase.auth.getSession().then((r) => r.data)` —
  `getSession()` devuelve `{ data: { session }, error }` (el `user` vive en `session.user`,
  no en `data.user`), y el `.then(r => r.data)` además des-anidaba `data` una vez de más, así
  que `data` quedaba `undefined`. Corregido al patrón canónico del resto del repo:
  `const { data: { session: authSession } } = await supabase.auth.getSession(); const user = authSession?.user;`
  en `createSession`, `joinSession`, `leaveSession`, `_subscribe` (transfer host) y `_startHeartbeat`.
- 2026-05-31 (**cola colaborativa**, Bloque 3.4): estado nuevo `suggestions[]` y `profilesById{}`.
  Acciones `suggestTrack(track)` (INSERT en [[jam_queue]]), `removeSuggestion(id)`,
  `reorderSuggestion(id,pos)` (host), `playSuggestion(id)` (host: marca `played_at` + aplica
  el track al [[player|store player]] local, que se propaga por [[use-jam-sync]]). Internos:
  `_resolveProfiles(ids)` (cachea avatar/nombre desde `profiles`), `_refreshSuggestions(sid)`
  (re-fetch ordenado por `played_at nulls first, position`). Canal CDC nuevo
  `jam-queue:<sessionId>` en `_subscribe`. `leaveSession`/`reset` limpian `suggestions` y
  `profilesById`. Ver [[Decisiones-Tecnicas-ADR|ADR-024]].
- 2026-06-02 (**arranque coordinado + avance FIFO**, Bloque 3.7): transporte por broadcast en el
  canal `jam:<id>` (`_bcastChannel`, eventos `prepare/ready/start/control`). Estado nuevo
  `readyByUser`/`waitingFor`/`_playId`. Métodos: `coordinatedPlay(track)` (prepare → espera
  ready de todos → start), `jamAdvance()` (host: siguiente sugerencia FIFO al terminar; cola
  vacía → pause), `forceStart()` (botón "Reproducir igualmente"), internos `_localPrepare`/
  `_markReady`/`_maybeStart`/`_broadcast`. `playSuggestion` ahora usa `coordinatedPlay`. Se
  retiró el broadcast de posición continuo. Ver [[Decisiones-Tecnicas-ADR|ADR-026]].
- 2026-06-02 (**pre-prepare**, Bloque 3.7): `_refreshSuggestions` emite `ritmiq:jam-preprepare`
  con la siguiente sugerencia pendiente (FIFO) → todos los clientes calientan su cache
  ([[local-downloads|jamCache]]) en background para que el próximo arranque coordinado sea casi
  instantáneo. Ver [[Decisiones-Tecnicas-ADR|ADR-027]].
- 2026-06-03 (**fix flujo coordinado roto**): reportado que el host sonaba solo, el guest no
  cargaba nada y al seleccionar reproducía ignorando la jam. Causas y fixes:
  1. El canal `jam:<id>` se creaba **sin** `config.broadcast` → los mensajes no fluían bien.
     Ahora `{ config: { broadcast: { self: true } } }`: el host también recibe su propio
     `prepare/start` y sigue el MISMO camino (handler) que los guests. Se quitó la llamada
     directa a `_localPrepare` en `coordinatedPlay` (la hace el handler). Flag `_started` evita
     doble arranque.
  2. El host **no** iniciaba el flujo coordinado al reproducir desde biblioteca/búsqueda (solo
     `playSuggestion` lo hacía). Ahora [[use-jam-sync]] (host) observa el cambio de
     `currentTrack` y, si difiere del jamState, llama `coordinatedPlay`.
  3. El handler `control` (play/pause/seek) ahora solo lo obedecen guests y actualiza `jamState`
     antes para que el guard read-only no lo revierta.
- 2026-06-03 (**modo Altavoz**, Bloque 3.8): estado `kind` (`'sync'|'speaker'`). `createSession(kind)`,
  `joinSession`/`_subscribe` leen `kind`. `requestControl(action,seconds)`: en speaker cualquier
  participante controla el altavoz (broadcast `control{speaker:true}` que solo el host ejecuta).
  Handler `control` ramifica sync/speaker. Handler `speaker-state` (remotos actualizan UI).
  `coordinatedPlay` en speaker reproduce directo en el host (sin handshake). Ver
  [[Decisiones-Tecnicas-ADR|ADR-028]].
