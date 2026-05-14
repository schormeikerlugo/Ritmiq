# Edge Function: recommendations

Genera recomendaciones musicales usando Last.fm para grafos de similitud
(artistas similares, tracks similares, top por género) e Innertube de YouTube
para resolver cada candidato a un `ytId` reproducible.

## Setup

1. Instalá la CLI de Supabase si no la tenés:
   ```bash
   curl -fsSL https://supabase.com/install.sh | sh
   ```
2. Hacé login y verificá el proyecto vinculado:
   ```bash
   supabase login
   supabase status   # debería mostrar ritmiq linked
   ```
3. Subí los secrets a producción (lee `supabase/.env` local):
   ```bash
   supabase secrets set --env-file supabase/.env
   ```
4. Deployea la función:
   ```bash
   supabase functions deploy recommendations
   ```
5. (Una sola vez) corré las migraciones:
   ```bash
   supabase db push
   ```

## Variables de entorno (secrets)

| Variable | Obligatoria | Descripción |
|---|---|---|
| `LASTFM_API_KEY` | sí | API key de Last.fm para llamadas read-only. |
| `LASTFM_SHARED_SECRET` | no | Reservado para Fase 3 (scrobble / write methods). |

Los `SUPABASE_*` (URL, ANON_KEY, SERVICE_ROLE_KEY) son auto-inyectados por
el runtime de Edge Functions — no hace falta setearlos manualmente.

## Endpoints

```
GET /functions/v1/recommendations?kind=<kind>&seed=<seed>
Headers:
  Authorization: Bearer <user-JWT>
  apikey: <ANON_KEY>
```

`kind` puede ser:
- `similar-artist` — `seed=<artista>`
- `mix-by-track` — `seed=<artista>::<título>`
- `genre-mix` — `seed=<tag>`
- `discover` — sin `seed`, usa historial + biblioteca del usuario.

Responde:
```json
{
  "kind": "similar-artist",
  "seed": "Bad Bunny",
  "tracks": [
    { "ytId": "...", "title": "...", "artist": "...", "thumbnail": "...", "duration": 211, "reason": "Similar a Bad Bunny" }
  ],
  "generatedAt": "2026-05-14T10:00:00Z",
  "cached": false
}
```

## Cache

Resultados se persisten en `recommendation_cache` con TTL 12h. La clave es
`sha256(userId + kind + seed)`. Llamadas repetidas dentro del TTL devuelven
instantáneo sin tocar Last.fm.
