---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/connection.js
tags: [helper, red, online, offline, supabase]
---

# `lib/connection.js`

> Detector de conectividad a Supabase. Combina `navigator.onLine` con un ping real a `/auth/v1/health` cada 25s. Emite a listeners cuando cambia el estado.

## Ubicación
`packages/ui/src/lib/connection.js:1` (76 líneas)

## Exports

```js
function isOnline(): boolean
function onConnectionChange(cb: (online: boolean) => void): () => void  // unsubscribe
```

## Diferencia con [[connectivity]]

`connection.js` es el detector simple (sí/no internet). [[connectivity]] es el detector completo que incluye LAN, Tunnel, source. Usar `connection.js` cuando solo se necesita saber si hay internet.

## Anatomía (snippet clave)

### Ping a `/auth/v1/health` y no a otro endpoint
`packages/ui/src/lib/connection.js:46-62`

```js
const res = await fetch(`${url}/auth/v1/health`, {
  method: 'GET',
  signal: ctrl.signal,
  headers: apikey ? { apikey } : {},
}).finally(() => clearTimeout(t));
setOnline(res.ok);
```

**Por qué `/auth/v1/health`**: endpoint que responde 200 sin requerir sesión y sin generar 401 en la consola. Un ping a `/rest/v1/tracks` requiere auth y generaría ruido de error.

## Polling interval: 25s

Balanceo entre detectar reconexión rápida y no abusar de la quota de Supabase.

## Side-effects

- Ping a Supabase cada 25s mientras haya listeners activos.
- Se detiene (`stopWatching`) cuando no hay listeners.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Bajar el interval a 2s | 30 pings/min × usuarios activos → cuota de Supabase agotada. |
| Ping a endpoint que requiere auth | 401 en consola en cada poll → ruido de debugging. |

## Notas / Changelog
- 2026-05-22: nivel medio.
