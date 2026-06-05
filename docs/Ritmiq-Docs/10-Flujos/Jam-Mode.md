---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-29
tags: [flujo, jam, realtime, colaborativo, sync]
---

# Jam mode — escucha colaborativa

> El host crea una sesión con un código corto. Los amigos se unen con el código. El host
> controla la reproducción; sus comandos (track/posición/play-pause) se propagan a los
> participantes via Supabase Realtime CDC. Cada cliente reproduce el mismo `ytId` desde su
> propia red (no hay transmisión de audio).

## Diagrama

```mermaid
sequenceDiagram
  participant H as Host (player)
  participant HS as use-jam-sync (host)
  participant JS as jam store
  participant DB as jam_sessions (Postgres)
  participant RT as Supabase Realtime
  participant GS as use-jam-sync (guest)
  participant G as Guest (player)

  H->>JS: createSession()
  JS->>DB: INSERT jam_sessions (code, host_id)
  JS->>DB: UPSERT jam_participants (self)
  JS->>RT: subscribe jam:<id> + jam-participants:<id>

  Note over H,G: Host comparte el código (copy/clipboard)

  G->>JS: joinSession(code)
  JS->>DB: SELECT por code
  JS->>DB: UPSERT jam_participants (self)
  JS->>RT: subscribe jam:<id>

  H->>HS: cambia track / play / posición
  HS->>JS: hostBroadcast(patch)  [optimista local]
  JS->>DB: UPDATE jam_sessions
  DB-->>RT: CDC (postgres_changes UPDATE)
  RT-->>GS: row nueva
  GS->>G: playNow / seek / set isPlaying

  Note over G: drift > 2s → CustomEvent ritmiq:seek

  H->>JS: leaveSession() (cerrar)
  JS->>DB: DELETE jam_sessions
  DB-->>RT: CDC DELETE
  RT-->>GS: delete
  GS->>JS: leaveSession() (auto)
```

## Modelo

- **Host → participants** (no peer-to-peer, sin WebRTC, sin transmisión de audio).
- Cada cliente reproduce el mismo `ytId` desde su propia conexión.
- Solo el host puede `UPDATE jam_sessions` (RLS). Los guests solo leen.
- **Roles** (Bloque 3.2): `jam_participants.role` (`host`/`guest`) para UI. El host puede
  **pasar el control** via `jam_transfer_host` → reasigna `host_id` y los roles; el cambio
  llega por CDC y cada cliente recalcula su `mode`. Ver [[jam_participants]] y [[jam|store jam]].

## Decisiones documentadas

- **Realtime Postgres CDC** en vez de WebRTC: simplicidad. El precio es drift de 1-3s entre
  clientes (sin sync de reloj preciso). Ver [[Decisiones-Tecnicas-ADR|ADR-019]] (sync Jam).
- **Optimista en el host**: `hostBroadcast` aplica el cambio local antes del round-trip;
  los guests esperan el CDC. Ver [[jam]].
- **Throttle de posición 5s**: el `positionSeconds` cambia ~30Hz; broadcast solo cada 5s +
  inmediato en track-change/play-pause. Ver [[use-jam-sync]].
- **Código legible**: 6 chars de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin 0/O, 1/I).
- **Cleanup 24h**: cron `ritmiq-cleanup-jam-sessions` borra sesiones stale. Ver [[jam_sessions]].

## Invitación via deep-link (Bloque 3.3)

- **Compartir**: en la vista `create`, "Compartir invitación" usa `navigator.share` (mobile)
  o copia el enlace `<origin>/jam/<CODE>` al portapapeles (desktop). Ver [[JamModal]].
- **Recibir**: [[App|App.jsx]] detecta `/jam/<code>` al boot (`detectJamDeepLink`), limpia la
  URL con `replaceState` y setea `pendingJoinCode` en [[jam|store jam]]. Cuando hay user
  logueado, monta el [[JamModal]] con `initialCode` → vista `join` pre-rellenada.
- ⚠️ **Verificación pendiente en prod**: `/jam/<code>` depende del SPA fallback de Vercel
  (Vite preset). `/share/track/*` ya funciona así; el middleware OG NO intercepta `/jam`. Si
  en prod diera 404, añadir un `vercel.json` con rewrite SPA para `/jam/:code`.

## Intro educativa (mini-wizard)

La 1ª vez que el usuario abre el [[JamModal]] ve una intro de 3 pasos que explica el modelo
(escucha sincronizada / el host controla / cada quien reproduce desde su propia red, con un
desfase de 1-2s que se corrige solo). Gate `localStorage` `ritmiq.jam-intro-seen`. Un
deep-link `/jam/<code>` salta la intro (el invitado va directo a unirse). Re-verible desde
"¿Cómo funciona una jam?" en el menú. Detalles en [[JamModal]].

## Gotchas conocidos

- **SELECT abierto**: la RLS de [[jam_sessions]] es `using (true)` → conociendo un código se
  puede leer el track actual de una sesión. Aceptable para uso personal/familiar.
- **Host abandona sin cerrar**: la sesión queda stale hasta el cron de 24h.
- **Drift**: umbral actual de corrección 2s (seek duro). Mejora planeada: compensación con
  `playbackRate` para drifts pequeños (Bloque 3.1, [[Decisiones-Tecnicas-ADR|ADR-019]]).

## Módulos involucrados

- UI: [[JamModal]].
- Estado: [[jam|store jam]].
- Bridge al player: [[use-jam-sync]].
- DB: [[jam_sessions]], [[jam_participants]].
- Player: [[player|store player]].

## Notas / Changelog

- 2026-05-29: flujo creado (F12, doc retroactiva de Fase 8).
