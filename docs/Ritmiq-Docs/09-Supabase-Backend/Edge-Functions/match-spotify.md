---
tipo: edge-function
capa: supabase
plataforma: backend
estado: wip
ultima-revision: 2026-05-22
archivo: supabase/functions/match-spotify/index.js
tags: [edge, spotify, matching, placeholder]
---

# `match-spotify`

> **Placeholder (Fase 5)** — Edge Function reservada para futuro matching Spotify→YouTube cuando lleguemos a la fase de OAuth de Spotify. Hoy responde `501 not_implemented`.

## Ubicación
`supabase/functions/match-spotify/index.js:1` (9 líneas)

## Estado actual

```js
serve(() => new Response(JSON.stringify({ error: 'not_implemented' }), {
  status: 501,
  headers: { 'content-type': 'application/json' },
}));
```

## Plan futuro

Cuando se implemente:
1. OAuth flow con Spotify (server-side, callback al Edge).
2. POST con `accessToken` de Spotify + `spotifyTrackId` → busca metadata.
3. Innertube search con `<artist> <title>` → devuelve `ytId`.
4. Persistir en cache.

Hoy el matching se hace cliente-side desde [[import]] store + [[lan-server]] `/spotify/playlist` (que parsea el embed público de Spotify, sin OAuth).

## Notas / Changelog
- 2026-05-22: nivel simple. Estado `wip`.
