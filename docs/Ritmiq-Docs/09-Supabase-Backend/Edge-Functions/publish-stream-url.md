---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-24
archivo: supabase/functions/publish-stream-url/index.ts
tags: [supabase, edge-function, p2p, cache, fase1]
created: 2026-05-23
deployed: gukzacuwcaqgkzchghcg
---

# publish-stream-url — Publica URL googlevideo al cache global

> **Tabla destino:** [[stream_url_cache]]
> **Auth:** Bearer JWT de usuario real (`auth.getUser`)
> **Rate-limit:** 200 upserts/min/user (in-memory)
> **Source:** `supabase/functions/publish-stream-url/index.ts`

## Propósito

Cuando el desktop resuelve una URL de googlevideo via yt-dlp, la publica acá para que otros usuarios sin LAN propio puedan consumirla via [[get-stream-url]] sin tener que correr yt-dlp ellos mismos. Reduce latencia de 1-3s a ~80-200ms para el consumidor.

## Endpoint

```
POST /functions/v1/publish-stream-url
Authorization: Bearer <user_jwt>
apikey: <project_anon_key>
Content-Type: application/json
```

Body:
```json
{
  "ytId": "wXz4CzACD1E",
  "url": "https://rrX---sn-...googlevideo.com/videoplayback?expire=...&signature=...",
  "contentType": "audio/mp4",
  "expiresAt": "2026-05-24T23:30:00Z",
  "source": "desktop"
}
```

Validación de TTL: `expires_at` debe estar entre 60s y 86400s (24h) en el futuro. URLs googlevideo expiran ~6h reales, dejamos 24h como max permitido para casos edge.

## Por qué exige JWT de usuario real (no ANON_KEY)

**Decisión deliberada:** `userClient.auth.getUser()` valida que el Authorization Bearer sea un JWT de usuario autenticado, no el ANON_KEY del proyecto.

- Anti-spam: cualquiera con ANON_KEY no debería poder llenar la tabla.
- Permite rate-limit per-user efectivo.

El cliente envía:
- `Authorization: Bearer <jwt>` — token de sesión del usuario (de `supabase.auth.getSession().access_token`).
- `apikey: <ANON_KEY>` — necesario para que el gateway de Supabase Functions identifique el proyecto.

## Caller (desktop main)

`apps/desktop/main/lan-server.js:publishToGlobalCache`. Llamado fire-and-forget desde:

1. `resolveCached()` tras yt-dlp exitoso en cualquier ruta `/stream/`.
2. `publishResolvedUrl()` exportado, invocado desde `ipc.js:yt:streamUrl` handler (cubre tracks ephemeral via IPC directo).

Requiere:
- `VITE_SUPABASE_URL` o `SUPABASE_URL` en env.
- `VITE_SUPABASE_ANON_KEY` para header `apikey`.
- `supabaseUserJwt` no null (sincronizado desde renderer via IPC `settings:setSupabaseToken`).

## Stats observables (publishStats)

Ver [[stream_url_cache#Stats observables]].

## Bug histórico arreglado (commit fe0b913)

Versión inicial usaba `Authorization: Bearer <ANON_KEY>` y devolvía 401 "invalid token". El fix:
- Sincronizar `supabase.auth.getSession().access_token` desde el renderer al main process via IPC al login + onAuthStateChange.
- Mandar JWT real como Authorization + ANON_KEY como apikey separado.

## Cross-references

- [[stream_url_cache]] — tabla destino
- [[get-stream-url]] — Edge de lectura
- [[publish-track-meta]] — primo (Fase 2, metadata)
- [[p2p-knowledge-sharing]] — flujo completo
