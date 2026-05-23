---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-presence.js
tags: [hook, presencia, social, realtime, supabase]
---

# `usePresence(userId, showActivity)`

> Publica el track actual del usuario en la tabla `presence` de Supabase cada 30 segundos. Solo activo con sesión + `showActivity = true`. TTL 2 min server-side: si la PWA backgroundea, la presencia expira sola.

## Ubicación
`packages/ui/src/lib/use-presence.js:1` (135 líneas)

## Constantes

```js
const INTERVAL_MS  = 30_000;   // upsert cada 30s
const EXPIRES_SECS = 120;      // TTL de la fila (2 min)
```

## Anatomía del código (snippets clave)

### 1. Refs para posición sin recrear el interval
`packages/ui/src/lib/use-presence.js:28-44`

```js
const trackRef       = useRef(currentTrack);
const isPlayingRef   = useRef(isPlaying);
const positionRef    = useRef(0);

// Sincronizar refs con state (sin rerun del effect)
trackRef.current     = currentTrack;
isPlayingRef.current = isPlaying;

// Actualizar posición en ref via suscripción ligera (no re-render)
useEffect(() => {
  return usePlayerStore.subscribe(
    (s) => s.positionSeconds,
    (pos) => { positionRef.current = pos; },
  );
}, []);
```

**Por qué refs y no deps del useEffect**: si `positionSeconds` fuera dep del effect principal, el `setInterval` se recrearía cada vez que la posición cambia (~10 veces/seg) → cada recreación hace un upsert inmediato → flood de requests Supabase.

Con refs, el `setInterval` solo se recrea si cambia `userId` o `showActivity`. La posición se lee de `positionRef.current` dentro del interval, que siempre tiene el valor más reciente.

### 2. Reacción rápida a play/pause sin esperar el interval
`packages/ui/src/lib/use-presence.js:99-111`

```js
const trackKey = currentTrack?.ytId ?? currentTrack?.id ?? null;
useEffect(() => {
  if (!userId || !showActivity) return;
  if (!isPlaying) {
    clearPresence(userId);  // borrar inmediatamente al pausar
  } else {
    publishNow(userId, trackRef.current, positionRef.current);  // publicar al reanudar
  }
}, [isPlaying, userId, showActivity, trackKey]);
```

**Por qué**: sin este effect, el amigo A vería a B "escuchando Arctic Monkeys" durante 30s aunque B ya pausó. Con `clearPresence` inmediato al pausar, B desaparece de la presencia de A en tiempo real.

**Por qué `trackKey` como dep**: cuando B cambia de track, los amigos deben ver el nuevo track cuanto antes, sin esperar el próximo tick del interval.

### 3. Cleanup activo al desmontar
`packages/ui/src/lib/use-presence.js:83-89`

```js
return () => {
  clearInterval(timer);
  clearPresence(userId);  // borrar presencia al logout/desmontaje
};
```

**Por qué no confiar solo en el TTL**: el TTL de 2 min es para el caso de crash o background sin cleanup. Al hacer logout voluntario, esperar 2 min sería malo: los amigos seguirían viendo "B está escuchando" durante 2 min después de que B cerró la app.

## Casos de borde

- **`showActivity` desactivado mientras reproducía**: el useEffect principal (dep `[userId, showActivity]`) corre y llama `clearPresence(userId)`.
- **Upsert fallido por red**: silencioso (sin retry). La presencia expira al TTL naturalmente.
- **Dos instancias del hook**: no debería ocurrir (solo se monta en App), pero si ocurriera, el `upsert ON CONFLICT user_id` garantiza una sola fila por usuario.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `positionSeconds` como dep del interval effect | Flood de upserts Supabase ~10/seg → quota agotada, rate limit. |
| Quitar `clearPresence` en cleanup | Al logout, el usuario aparece como "escuchando" a sus amigos 2 minutos más. |
| Quitar el effect de reacción rápida | Amigos ven presencia 30s después de pausa/reanuda/cambio de track. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
