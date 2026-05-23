---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/tunnel-registry.js
tags: [helper, tunnel, cloudflare, supabase, realtime]
---

# `lib/tunnel-registry.js`

> Publicación y suscripción de la URL del Cloudflare Tunnel via Supabase (`tunnel_endpoints`). Desktop publica; PWA suscribe con pull inicial + Realtime para actualizarse automáticamente.

## Ubicación
`packages/ui/src/lib/tunnel-registry.js:1` (125 líneas)

## Exports

```js
async function publishTunnelUrl(userId, url, source?, accessToken?): Promise<void>
async function clearTunnelUrl(userId): Promise<void>
function subscribeTunnelUrl(userId, onChange?): () => void  // unsubscribe
```

## Por qué existe

El Quick Tunnel de Cloudflare genera una URL aleatoria en cada arranque del Desktop. Sin este registry, el usuario tendría que pegar la URL manualmente en la PWA cada vez que reinicia el Desktop. Con el registry, el Desktop publica la URL nueva → la PWA la recibe via Realtime → se actualiza sin intervención.

## Decisión crítica en `subscribeTunnelUrl`
`packages/ui/src/lib/tunnel-registry.js:84-88`

```js
// NUNCA borramos el tunnelUrl local desde aqui aunque Supabase
// devuelva null. Razon: cuentas pareadas (no owner) NO tienen fila
// propia → siempre verían url=null y se les borraría su tunnelUrl
// persistido via pareo.
```

**El problema**: la tabla `tunnel_endpoints` solo la publica el propietario del Desktop. Una cuenta pareada (no owner) nunca tiene su propia fila → el query maybeSingle devuelve null → sin este guard, se borraría el tunnelUrl persistido del dispositivo pareado.

## Tabla usada

`tunnel_endpoints` (una fila por usuario / Desktop):

| Columna | Descripción |
|---|---|
| `user_id` | PK — un solo registro por usuario |
| `url` | URL pública del tunnel actual |
| `source` | `'quick'` \| `'named'` \| `'custom'` |
| `access_token` | Token Bearer para auth en el LAN server |
| `updated_at` | Timestamp del último update |

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Borrar `tunnelUrl` local cuando Supabase devuelve null | Dispositivos pareados pierden su URL del tunnel al arrancar → no pueden conectar hasta que el owner reinicie el Desktop. |
| Sin Realtime (solo pull inicial) | Quick Tunnel que cambia de URL no se propaga → dispositivos pareados quedan con URL vieja. |

## Notas / Changelog
- 2026-05-22: nivel medio.
