---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-24
archivo: supabase/functions/get-stream-url/index.ts
tags: [supabase, edge-function, p2p, cache, fase1]
created: 2026-05-23
deployed: gukzacuwcaqgkzchghcg
---

# get-stream-url — Lee URL googlevideo del cache global

> **Tabla origen:** [[stream_url_cache]]
> **Auth:** Bearer JWT (acepta ANON_KEY tambien para consumer side sin friccion)
> **Cache CDN:** `Cache-Control: public, max-age=60` en HIT
> **Source:** `supabase/functions/get-stream-url/index.ts`

## Propósito

Cualquier cliente con sesión Supabase puede consultar si el cache global tiene una URL vigente para un `ytId`. Si HIT, ahorra 1-3s de yt-dlp. Si MISS, el cliente cae al fallback normal (resolve-stream Edge → yt-dlp).

## Endpoint

```
GET /functions/v1/get-stream-url?ytId=wXz4CzACD1E
Authorization: Bearer <user_jwt>
```

Respuesta HIT (200):
```json
{
  "url": "https://rrX---sn-...googlevideo.com/videoplayback?...",
  "contentType": "audio/mp4",
  "expiresAt": "2026-05-24T23:30:00Z",
  "source": "desktop"
}
```

Respuesta MISS (404):
```json
{ "url": null }
```

## Política de TTL

Margen de seguridad: el SELECT exige `expires_at > now() + 30s`. Si la URL expira en menos de 30s no la devolvemos — el cliente la consumiría e inmediatamente fallaría al stream.

## Caching CDN

- HIT: `Cache-Control: public, max-age=60` — Cloudflare cachea 60s.
- MISS: `Cache-Control: no-store`.

Razon: una URL nueva publicada inmediatamente debe estar visible (no cachear miss). Pero una HIT se puede compartir a multiples clientes en la misma ventana de 60s sin re-pegar a la BD.

## Lectura cross-user

NO filtra por user_id. Cualquier user logueado puede leer lo que otro user publicó. **Diseño intencional:**
- Beneficia al consumidor sin coste para el publisher.
- Privacidad: la tabla [[stream_url_cache]] no contiene info identificable.

## Caller (renderer)

`packages/ui/src/lib/use-player.js:getGlobalCachedUrl` — paso 3 del cascade en `resolveAudioSource` (ver [[audio-source]]):

```
1. local downloaded     ← descargado del propio user
2. LAN server           ← desktop propio (si existe)
3. get-stream-url       ← cross-user cache global  ← AQUI
4. resolve-stream       ← fallback yt-dlp cloud
```

## Telemetría observable

El origen de cada reproducción se contabiliza en `streamOriginCounts` (export de use-player.js). El badge "cache-global-url" aparece cuando un HIT de esta Edge sirve el audio.

Visible en `Settings → Diagnóstico → "Orígenes de stream (esta sesión)"`.

## Cross-references

- [[stream_url_cache]] — tabla origen
- [[publish-stream-url]] — Edge writer
- [[audio-source]] — cascade que la consume
- [[p2p-knowledge-sharing]] — flujo completo
