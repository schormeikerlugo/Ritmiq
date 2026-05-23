---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/lan-client.js
tags: [helper, lan, red, streaming, firma, hmac]
---

# `lib/lan-client.js`

> Cliente del LAN server desde la UI. Gestiona localStorage de URL/token, pings de disponibilidad, URLs firmadas HMAC (sign-stream), búsqueda y streaming vía LAN, keepalive del tunnel y caché de items compartidos.

## Ubicación
`packages/ui/src/lib/lan-client.js:1` (425 líneas)

## Exports (20 funciones)

| Función | Descripción |
|---|---|
| `getLanBaseUrlSync()` | Lee `ritmiq:lan:lastBaseUrl` de localStorage. |
| `setLanBaseUrl(url)` | Persiste la base URL del LAN server. |
| `getTunnelUrlSync()` | Lee `ritmiq:lan:tunnelUrl` de localStorage. |
| `setTunnelUrl(url)` | Persiste la URL del tunnel. |
| `getAccessTokenSync()` | Lee `ritmiq:lan:accessToken` (owner) o `ritmiq:device:token` (pareado). |
| `setAccessToken(token)` | Persiste el access token del owner. |
| `authHeaders()` | `{ Authorization: 'Bearer <token>' }`. |
| `withTokenInUrl(url)` | Añade `?token=<token>` a la URL (para `<audio>` que no acepta headers). |
| `pingLan(baseUrl, timeoutMs)` | GET `/health` con timeout. Devuelve bool. |
| `getReachableLanBaseUrl()` | Prueba LAN (1.2s) y Tunnel (2.5s) en paralelo, retorna la que responde. |
| `autoDetectLanFromHost()` | En desktop, usa `api.appInfo()` para obtener el puerto LAN local. |
| `getSignedStreamUrl(trackId, lanBaseUrl)` | Pide HMAC firmada a Edge [[sign-stream]]. Cache por trackId. |
| `clearSignedStreamCache()` | Limpia la caché de URLs firmadas. |
| `lanSearch(query)` | GET `/yt/search?q=` en LAN server. |
| `lanMetadata(idOrUrl)` | GET `/yt/metadata?q=` en LAN server. |
| `lanStreamUrl(trackId)` | Construye URL del stream LAN con token. |
| `prewarmStream(ytId)` | Fire-and-forget GET `/yt/prewarm?q=` (prioridad 5). |
| `checkSharedCache(ytIds)` | GET `/shared-cache/check?yt=...` bulk. |
| `startTunnelKeepalive()` | Ping periódico al tunnel para evitar que Cloudflare lo cierre. |
| `lanSpotifyPlaylist(spotifyUrl)` | GET `/spotify/playlist?url=` en LAN server. |

## Keys localStorage

| Key | Descripción |
|---|---|
| `ritmiq:lan:lastBaseUrl` | IP local del LAN server (`http://192.168.x.x:3939`) |
| `ritmiq:lan:tunnelUrl` | URL pública del Cloudflare Tunnel |
| `ritmiq:lan:accessToken` | Bearer token del owner del Desktop |

**Nota**: el `device_token` del pareo vive en `ritmiq:device:token` (gestionado por [[device]]).

## Anatomía del código (snippets clave)

### 1. `getAccessTokenSync()`: prioridad device_token > owner token
`packages/ui/src/lib/lan-client.js:131-138` (approx)

```js
export function getAccessTokenSync() {
  try {
    // 1. device_token (si está pareado)
    const deviceToken = localStorage.getItem('ritmiq:device:token');
    if (deviceToken) return deviceToken;
    // 2. access_token del owner (si la PWA tiene el del propio desktop)
    return localStorage.getItem('ritmiq:lan:accessToken');
  } catch { return null; }
}
```

**Por qué priorizar device_token**: una PWA pareada debe autenticarse con su token de device, no con el del owner (que podría no estar en el localStorage de una PWA externa).

### 2. `withTokenInUrl`: `<audio>` no acepta headers custom
`packages/ui/src/lib/lan-client.js:161-172` (approx)

```js
export function withTokenInUrl(url) {
  const token = getAccessTokenSync();
  if (!token || !url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('token', token);
    return u.toString();
  } catch { return url; }
}
```

**Por qué en la URL y no en el header**: el elemento HTML `<audio>` no puede enviar headers personalizados en sus requests. El LAN server acepta `?token=` como alternativa al header `Authorization: Bearer`. El token queda visible en los logs del proxy, pero es un trade-off inevitable para reproducción nativa de audio.

### 3. `getSignedStreamUrl`: HMAC firmada via Edge + caché
`packages/ui/src/lib/lan-client.js:42-91` (approx)

```js
const signedCache = new Map();  // trackId → Promise<string>

export async function getSignedStreamUrl(trackId, lanBaseUrl) {
  const hit = signedCache.get(trackId);
  if (hit) return hit;

  const p = (async () => {
    const session = await supabase.auth.getSession();
    const token = session.data?.session?.access_token;
    // Llama a Edge sign-stream para obtener la URL firmada con HMAC
    const url = `${SUPABASE_URL}/functions/v1/sign-stream?trackId=...&lanBaseUrl=...`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    // ... devuelve la URL firmada (incluye ?sig=&exp=)
  })();

  signedCache.set(trackId, p);
  p.catch(() => signedCache.delete(trackId));
  return p;
}
```

**Por qué caché de la Promise**: la firma HMAC es costosa (llamada a Edge Function, ~200ms). Si dos componentes piden la URL del mismo track casi simultáneamente, comparten la misma Promise → una sola llamada al Edge.

**Por qué HMAC y no solo Bearer**: el Bearer del owner funciona para la propia app. La URL firmada puede pasarse a un `<video>` o `<audio>` en una página pública (share feature) donde no hay Bearer disponible.

### 4. `startTunnelKeepalive`: evitar timeout de Cloudflare
`packages/ui/src/lib/lan-client.js:381-412` (approx)

```js
export function startTunnelKeepalive() {
  // Cloudflare cierra los túneles Quick después de ~5 min sin tráfico.
  // Un ping cada 3 minutos mantiene el túnel vivo.
  const KEEPALIVE_MS = 3 * 60 * 1000;
  const run = async () => {
    const url = getTunnelUrlSync();
    if (url) {
      try {
        await fetch(`${url}/health`, { method: 'GET' }).catch(() => {});
      } catch {}
    }
  };
  run();
  return setInterval(run, KEEPALIVE_MS);
}
```

**Por qué `/health`**: es el endpoint más ligero del [[lan-server]], sin auth, siempre 200.

## Casos de borde

- **`lanBaseUrl` y `tunnelUrl` ambos disponibles**: `getReachableLanBaseUrl` prueba en paralelo y usa el que responde primero. Si LAN responde primero (típico en casa) → latencia mínima.
- **Firma HMAC para device no-owner**: el Edge `sign-stream` valida que el usuario tenga el track en su biblioteca (RLS). Sin la validación, un atacante con la URL del LAN server podría acceder a cualquier track.
- **`checkSharedCache` cap 100 ids**: el LAN server también limita a 100. Más de 100 ids en una sola query generaría un SQL `IN (...)` muy largo.

## Performance y costes

| Operación | Tiempo típico |
|---|---|
| `pingLan(lan, 1200)` | < 5ms en LAN local |
| `pingLan(tunnel, 2500)` | 50-200ms (depende del edge CF) |
| `getSignedStreamUrl` (no cacheado) | ~200ms (Edge Function) |
| `getSignedStreamUrl` (cacheado) | < 1ms |
| `lanSearch` | ~800ms (prewarm incluido) |
| `startTunnelKeepalive` | Ping cada 3 min |

## Dependencias entrantes
- [[api|ui/lib/api]] → `lanSearch`, `lanMetadata`, `getLanBaseUrlSync`, `getTunnelUrlSync`.
- [[use-player]] → `getLanBaseUrlSync`, `getTunnelUrlSync`, `pingLan`, `getSignedStreamUrl`, `withTokenInUrl`.
- [[connectivity]] → `getLanBaseUrlSync`, `getTunnelUrlSync`, `pingLan`.
- [[tunnel-registry]] → `setTunnelUrl`, `getTunnelUrlSync`, `setAccessToken`, `getAccessTokenSync`.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `withTokenInUrl` que pone token en header | El `<audio>` HTML no puede enviar headers → 401 en todos los streams. |
| Sin caché en `getSignedStreamUrl` | Dos llamadas simultáneas a [[sign-stream]] por el mismo track → 2× invocaciones Edge. |
| `getAccessTokenSync` que no prioriza device_token | PWA pareada se autentica con token del owner (no tiene) → 401 en todos los endpoints. |
| `startTunnelKeepalive` con 10 min en lugar de 3 min | El Quick Tunnel se cierra por inactividad → PWA pierde conexión. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
