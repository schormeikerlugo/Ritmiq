---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/connectivity.js
tags: [helper, red, connectivity, lan, tunnel, backoff]
---

# `lib/connectivity.js`

> Detector unificado de conectividad con tres canales (internet, LAN, tunnel) y backoff exponencial por canal. Calcula la fuente óptima para audio (`source`). Emite a listeners cuando cambia.

## Ubicación
`packages/ui/src/lib/connectivity.js:1` (199 líneas)

## Exports

```js
function getConnectivity(): ConnectivityState
function onConnectivityChange(cb): () => void   // unsubscribe
function forceRecheck(): void                   // reagenda todos los canales inmediatamente
```

## `ConnectivityState`

```js
{
  internet: boolean,
  lan: boolean,
  tunnel: boolean,
  desktopReachable: boolean,   // lan || tunnel
  source: 'local'|'lan'|'tunnel'|'cloud'|'offline',
}
```

## Intervalos de polling

| Canal | Estable (OK) | Fallo inicial | Backoff máximo |
|---|---|---|---|
| internet | 30s | 3s | 5 min |
| lan | 15s | 3s | 5 min |
| tunnel | 45s | 3s | 5 min |

LAN cada 15s (más frecuente) porque el usuario puede conectar/desconectar la WiFi localmente. Tunnel cada 45s (menos frecuente) porque es una conexión remota que cambia más raramente.

## Anatomía del código (snippets clave)

### Scheduler con backoff exponencial por canal
`packages/ui/src/lib/connectivity.js:133-155`

```js
function schedule(name, probe) {
  const ch = channels[name];
  const run = async () => {
    const ok = await probe();
    const changed = setChannel(name, ok);
    if (ok) {
      ch.backoff = BACKOFF_MIN_MS;
      ch.timer = setTimeout(run, STABLE_MS[name]);  // intervalo estable
    } else {
      ch.timer = setTimeout(run, ch.backoff);
      ch.backoff = Math.min(BACKOFF_MAX_MS, Math.round(ch.backoff * 1.8));  // 1.8x
    }
    if (changed) emit();
  };
  ch.timer = setTimeout(run, 0);  // primer probe inmediato
}
```

**Por qué 1.8x y no 2x**: backoff menos agresivo que exponencial puro. 3s → 5.4s → 9.7s → 17.5s... alcanza 5 min en ~13 fallos. Con 2x llegaría antes con más "hops" vacíos iniciales.

### `recomputeSource`: prioridad LAN > Tunnel > Cloud
`packages/ui/src/lib/connectivity.js:78-92`

```js
const next =
  state.lan    ? 'lan'
  : state.tunnel ? 'tunnel'
  : state.internet ? 'cloud'
  : 'offline';
```

**Por qué LAN primero**: el LAN server es más rápido que el tunnel (menos latencia), sin quota de yt-dlp en el cloud. Un track que puede venir por LAN siempre debe preferirlo.

### Revalidación al volver del background
`packages/ui/src/lib/connectivity.js:189-191`

```js
document.addEventListener('visibilitychange', onVisibility);
function onVisibility() {
  if (document.visibilityState === 'visible') forceRecheck();
}
```

**Por qué**: si el móvil pasa 5 minutos en background, el backoff puede haber subido a 5 min. Al volver al foreground, queremos detectar la red disponible al instante, no esperar el próximo tick del backoff.

## Casos de borde

- **`lan` URL vacía**: `getLanBaseUrlSync()` devuelve null → `probeLan` devuelve false sin hacer ping.
- **Tunnel sin token**: `getTunnelUrlSync()` devuelve null → `probeTunnel` idem.
- **`navigator.onLine = false`**: `probeInternet` devuelve false inmediatamente sin fetch.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar `forceRecheck` en visibilitychange | Al volver del background con 5 min sin red, la app no detecta que volvió la conexión hasta el próximo tick del backoff. |
| `source: 'cloud'` primero en `recomputeSource` | Tracks que podrían servirse por LAN van al cloud → latencia + quota. |
| Sin backoff (solo STABLE_MS) | Un canal caído se pingeará a frecuencia normal → flood cuando Supabase tiene downtime. |

## Notas / Changelog
- 2026-05-22: nivel medio.
