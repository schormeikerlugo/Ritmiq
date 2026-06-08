---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-29
archivo: packages/ui/src/lib/use-jam-sync.js
tags: [hook, jam, player, sync, realtime]
---

# `useJamSync`

> Bridge entre [[jam|store jam]] y [[player|store player]]. Si `hosting`, broadcast los cambios del player local al jam. Si `guest`, aplica el state del host al player local. Montar una sola vez en [[App|App.jsx]].

## Ubicación
`packages/ui/src/lib/use-jam-sync.js`

## Firma
```js
function useJamSync(): void
```

## Anatomía del código (snippets comentados)

### HOSTING: broadcast granular + throttle de posición
`packages/ui/src/lib/use-jam-sync.js:76-83`

```js
// Position broadcast con throttle 5s.
const posInterval = setInterval(() => {
  const { currentTrack, positionSeconds, isPlaying } = usePlayerStore.getState();
  if (!currentTrack || !isPlaying) return;
  if (Math.abs(positionSeconds - lastBroadcastPosRef.current) < 1) return;
  lastBroadcastPosRef.current = positionSeconds;
  hostBroadcast({ positionSeconds });
}, POSITION_BROADCAST_INTERVAL_MS);
```

**Por qué**: el `positionSeconds` cambia ~30Hz; sin throttle saturaríamos Postgres. Track-change y play/pause se broadcastean inmediatamente (subscribe granular); la posición solo cada 5s.

### GUEST: corrección de drift en tres niveles (Bloque 3.1)
`packages/ui/src/lib/use-jam-sync.js`

```js
const drift = player.positionSeconds - positionSeconds; // <0: guest atrasado
const absDrift = Math.abs(drift);
if (absDrift >= DRIFT_HARD_SECONDS) {        // >= 1.5s → seek duro (audible)
  dispatchSeek(positionSeconds);
  if (guestRateRef.current !== 1) { guestRateRef.current = 1; dispatchRate(1); }
} else if (absDrift >= DRIFT_SOFT_SECONDS) {  // 0.5-1.5s → playbackRate (inaudible)
  const targetRate = drift < 0 ? RATE_CATCH_UP : RATE_SLOW_DOWN; // 1.02 / 0.98
  if (guestRateRef.current !== targetRate) { guestRateRef.current = targetRate; dispatchRate(targetRate); }
} else if (guestRateRef.current !== 1) {      // < 0.5s → alineado, rate normal
  guestRateRef.current = 1; dispatchRate(1);
}
```

**Por qué**: solo el drift grande hace seek audible. El drift mediano se corrige acelerando
o frenando el playbackRate 2% (inaudible) hasta alinear. `guestRateRef` evita re-disparar el
evento en cada tick. Implementado con `setRate` en [[html-audio-backend]]/[[howler-backend]]
+ evento `ritmiq:set-rate` en [[use-player]]. Ver [[Decisiones-Tecnicas-ADR|ADR-019]].

### Track change en guest: playNow + seek diferido
`packages/ui/src/lib/use-jam-sync.js:105-118`

```js
if (!sameTrack) {
  player.playNow([currentTrack], 0);
  setTimeout(() => {                 // delay para que el track cargue antes del seek
    if (positionSeconds > 0) window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds: positionSeconds } }));
    if (!isPlaying) usePlayerStore.setState({ isPlaying: false });
  }, 250);
  return;
}
```

**Por qué**: el seek debe ocurrir tras la carga del nuevo track; de ahí el `setTimeout(250)`.

## Side-effects
- DOM: `window.dispatchEvent('ritmiq:seek')`.
- Subscribe a [[player|store player]] (track, isPlaying) + interval de posición.

## Casos de borde y gotchas
- **`modeRef` para evitar stale closures**: los subscribers chequean `modeRef.current` antes de actuar.
- **Guest no controla**: el bridge sobreescribe el player local con el state del host; los controles locales quedan efectivamente bloqueados.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Quitar el throttle de posición | Saturación de UPDATEs a Postgres → rate limit / lag. |
| Cambiar el nombre del evento `ritmiq:seek` | El player no escucha → guests no corrigen drift. |

## Dependencias
- [[jam|store jam]], [[player|store player]].

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8.3). Anotada mejora de drift (Bloque 3.1).
- 2026-05-31 (**fix crítico**): el host no propagaba el track → los guests no reproducían la
  misma canción. Los `usePlayerStore.subscribe((s)=>s.x, cb)` de este hook requieren el
  middleware `subscribeWithSelector`, que faltaba en [[player|store player]]; en zustand 5 el
  `cb` nunca corría. Se añadió el middleware al store (sin tocar este hook). Ver
  [[Decisiones-Tecnicas-ADR|ADR-023]].
