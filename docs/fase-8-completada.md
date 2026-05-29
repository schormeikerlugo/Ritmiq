# Fase 8 — Jam mode ✓

Sesiones de escucha colaborativa en tiempo real con modelo
host→participants. El host controla la reproducción; los participantes
siguen sincronizados via Supabase Realtime CDC.

3 commits atómicos. Build PWA + AppImage verde.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 8.1 | `feat(jam): protocolo sync via Supabase Realtime` | (8.1) | Tablas + RLS + Realtime + store cliente. |
| 8.2 | `feat(jam): UI invitar + unirse a jam (modal)` | (8.2) | JamModal con 4 views + entry point en NowPlaying. |
| 8.3 | `feat(jam): cola colaborativa + sync player↔jam state` | `007aff2` | Hook useJamSync bridge bidireccional. |

## Cambios por área

### Backend (8.1)

- **Migración** `20260528000001_jam_mode.sql`:
  - `jam_sessions(id, host_id FK auth.users, code unique 6 chars, current_track jsonb, position_seconds, is_playing, queue jsonb)`.
  - `jam_participants(session_id FK, user_id FK, joined_at, last_seen_at, PK compuesta)`.
  - Realtime habilitado en ambas tablas.
  - RLS estricto: sessions UPDATE/DELETE solo el host. Participants solo el propio user.
  - `generate_jam_code()` SQL: 6 chars uppercase sin O/0/I/1 (legible oral).
  - Cron `ritmiq-cleanup-jam-sessions @ 04:30 UTC` borra sesiones > 24h sin actividad.

### Cliente (8.1 + 8.2 + 8.3)

- **`stores/jam.js`** (8.1):
  - 3 modes: `idle | hosting | guest`.
  - `createSession()`: retry x5 si colisión de código (error `23505`), upsert participant, subscribe Realtime.
  - `joinSession(code)`: lookup por código, distingue si el usuario es el host real.
  - `leaveSession()`: cleanup channels + heartbeat **antes** de queries (evita race condition de re-render con stale state).
  - `hostBroadcast(patch)`: optimistic local + UPDATE en Postgres. RLS rechaza guests.
  - `_subscribe(id)`: 2 channels (sessions UPDATE/DELETE + participants `*`).
  - `_startHeartbeat()`: UPDATE `last_seen_at` cada 30s.
- **`components/Jam/JamModal.jsx`** (8.2): 4 views (menu/create/join/guest). Código grande copiable con `Link` icon + lista participantes con `BadgeCheck` para el host.
- **`lib/use-jam-sync.js`** (8.3): bridge bidireccional.
  - Hosting: subscribe granular a `currentTrack.id` y `isPlaying`. Position broadcast con throttle 5s.
  - Guest: aplica state al player. Si track diferente → `playNow + seek`. Si drift > 2s → seek correctivo.

## Verificación manual

1. **Crear jam**:
   - User A abre NowPlaying → menú "..." → "Jam con amigos" → "Iniciar jam".
   - Aparece código de 6 chars (ej. `ABC234`).
   - User A reproduce un track. El position se actualiza en `jam_sessions` cada 5s.

2. **Unirse a jam**:
   - User B abre NowPlaying → "..." → "Jam con amigos" → "Unirse" → tipea código.
   - User B ve a A en la lista de participantes con `BadgeCheck` (host).
   - Cuando A cambia de track, B lo recibe via Realtime y empieza a reproducir lo mismo en su player.

3. **Pausa**:
   - A pausa → B se pausa.

4. **Sync drift**:
   - B abre la app en otra ventana → `useJamSync` recibe el state y aplica seek correctivo si > 2s de drift.

5. **Host se va**:
   - A pulsa "Cerrar jam" → DELETE jam_sessions cascade → B recibe el DELETE event y auto-leave.

## Deploys aplicados

```bash
# Migración + cron via Management API:
# POST /v1/projects/<ref>/database/query con el SQL completo.
# Verificación:
select jobid, jobname from cron.job where jobname like 'ritmiq-cleanup-jam%';
# → 1 job activo.
```

## Limitaciones conocidas

- **Sin TURN/STUN para audio peer-to-peer**: los participantes reproducen el mismo track localmente (cada uno con su backend). No hay transmisión de audio del host. Aceptable: el catalogo es público (YouTube), cada cliente puede resolver el mismo `ytId`.
- **Position drift**: el throttle de broadcast es 5s. Drift máximo ~5s antes del próximo correctivo. Para una mejor sync, usar Realtime presence o broadcast con WebRTC datachannel (futuro).
- **Sin permission system**: cualquier guest puede pulsar play/pause/next localmente, pero el próximo broadcast del host re-aplica el state real. Suficiente como deterrente UX; para "mute total del guest" hace falta deshabilitar los botones en el Player cuando `mode === 'guest'`.
- **Cron en UTC**: limpieza de sesiones inactivas a 04:30 UTC.
- **`queue` no se broadcast en V1**: la columna está pero el host no la actualiza. Próxima iteración: drag tracks de la cola del host se propaga a los guests.

## Estado global del proyecto

- ✓ Fase 0 (5 commits)
- ✓ Fase 1 (5 commits)
- ✓ Fase 2 (6 commits)
- ✓ Fase 3 (5 commits)
- ✓ Fase 4 (9 commits)
- ✓ Fase 5 (4 commits)
- ✓ Fase 6 (3 commits)
- ✓ Fase 7 (5 commits)
- ✓ Fase 8 (3 commits) — **jam mode**

**Plan general completo: las 8 fases ejecutadas.**
