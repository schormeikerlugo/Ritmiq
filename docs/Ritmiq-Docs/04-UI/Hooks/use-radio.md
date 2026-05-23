---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-radio.js
tags: [hook, radio, cola, auto-extend]
---

# `useRadioAutoExtend()`

> Monitoriza el modo Radio en [[player]] store y auto-extiende la cola cuando quedan ≤ 2 tracks por delante. Se monta una vez a nivel de App.

## Ubicación
`packages/ui/src/lib/use-radio.js:1` (54 líneas)

## Constantes

```js
const REMAINING_THRESHOLD = 2;   // tracks restantes para disparar extend
const BATCH_SIZE = 12;           // tracks por batch de radio
```

## Anatomía del código (snippet clave)

### Anti-double-fire con ref + cooldown
`packages/ui/src/lib/use-radio.js:16-52`

```js
const extendingRef = useRef(false);

const unsub = usePlayerStore.subscribe((state) => {
  if (!state.radioMode) return;
  if (extendingRef.current) return;   // ya extendiendo
  const remaining = state.queue.length - state.index - 1;
  if (remaining > REMAINING_THRESHOLD) return;

  const seed = state.currentTrack;
  if (!seed) return;

  extendingRef.current = true;
  try {
    const excludeIds = new Set(state.queue.map((t) => t.id));
    const batch = buildRadioBatch({
      seedTrack: { ...seed, artist: state.radioSeedArtist ?? seed.artist },
      batchSize: BATCH_SIZE,
      excludeIds,
    });
    if (batch.length > 0) {
      usePlayerStore.getState().appendQueue(batch);
    }
  } finally {
    setTimeout(() => { extendingRef.current = false; }, 200);
  }
});
```

**Por qué `extendingRef`**: la suscripción de Zustand puede dispararse varias veces muy rápido cuando el batch se aplica (cada `appendQueue` dispara re-evaluación). Sin el ref, se llamaría `buildRadioBatch` múltiples veces antes de que el estado se propague.

**Por qué `state.radioSeedArtist` en lugar de `currentTrack.artist`**: el seed del radio se fija cuando el usuario activa el modo. Si el track actual cambia durante el radio, seguimos generando batches del artista original, no del track en curso. Ver [[player#startRadio]].

**Por qué `excludeIds` de toda la cola**: evitar que el radio añada tracks ya presentes en la cola actual (no solo el track reproducido).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `extendingRef` | `buildRadioBatch` llamado múltiples veces → cola inflada con tracks duplicados. |
| Usar `currentTrack.artist` como seed | Cada cambio de track cambia el seed → radio inconsistente. |
| `REMAINING_THRESHOLD = 0` | El extend se dispara cuando ya no hay tracks → pausa antes del nuevo batch. |

## Notas / Changelog
- 2026-05-22: nivel simple.
