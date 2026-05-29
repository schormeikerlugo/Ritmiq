# Fase 6 — Multi-fuente recs ✓

Fuente alternativa de recomendaciones (YouTube Innertube watch-next) +
scoring híbrido que combina varias fuentes con consensus boost +
infraestructura completa para Spotify OAuth PKCE (sin UI todavía).

3 commits atómicos. Build PWA + AppImage verde.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 6.1 | `feat(recs): edge function yt-recs (Innertube watch-next)` | `2cf5237` | `_shared/innertube.ts` + edge `yt-recs` + store cliente. |
| 6.2 | `feat(home): scoring hibrido para mix-by-track` | `144ab95` | `combineSources` con consensus boost integrado en Home. |
| 6.3 | `feat(spotify): infraestructura OAuth PKCE` | `cccf527` | Tabla `spotify_tokens` + edge `spotify-callback` + lib cliente. |

## Cambios por área

### Backend nuevo

- **`_shared/innertube.ts`** (Fase 6.1): cliente reutilizable. `ytNext(videoId)` extrae `compactVideoRenderer` de `secondaryResults`. Filtra el seed propio.
- **`yt-recs/`** edge function: GET con seedYtId → POST a Innertube `/next` → cache 6h en `recommendation_cache` con `kind='yt-recs'` + `cache_key=sha256("yt-recs:<seedYtId>")` global.
- **`spotify-callback/`** edge function: POST con `{ code, codeVerifier, redirectUri }` → POST a `accounts.spotify.com/api/token` → UPSERT en `spotify_tokens` con margen de 30s.
- **Migración** `spotify_tokens.sql`: tabla con FK a `auth.users`, RLS owner read+delete, service role escribe.

### Cliente nuevo

- **`stores/yt-recs.js`** (Fase 6.1): `useYtRecsStore.fetch(seedYtId)` con withRetry maxAttempts=2.
- **`lib/hybrid-scoring.js`** (Fase 6.2):
  - `SOURCE_WEIGHTS`: lastfm 1.0, yt 0.85, spotify 1.1.
  - `CONSENSUS_BOOST_PER_EXTRA_SOURCE`: 0.5.
  - `combineSources([{source, tracks}])` + helper `combineTwoSources`.
  - Tracks salida incluyen `.hybridScore` y `.hybridSources`.
- **`lib/spotify-oauth.js`** (Fase 6.3):
  - `startSpotifyAuth()` PKCE flow + sessionStorage.
  - `exchangeCodeForToken(code, state)` valida state + llama edge.
  - `disconnectSpotify()` borra el token local.
  - `getSpotifyConnectionStatus()` checa presencia.

### Home integration (6.2)

- `byTrackRec` ahora es `useMemo` derivado de `mix-by-track` (Last.fm) + `yt-recs` (YouTube).
- `combineTwoSources` con limit 20.
- `sourcesUsed` array para que la UI pueda mostrar badge con fuentes activas.

## Bundle impact

| Stage | Precache | Delta vs Fase 7 |
|---|---|---|
| Tras 6.1 (store no importado) | 2320 KiB | sin cambio |
| Tras 6.2 (Home + hybrid-scoring) | 2324 KiB | +3 KB |
| Tras 6.3 (lib spotify-oauth, no importado) | 2324 KiB | sin cambio |

## Deploys aplicados

```bash
supabase functions deploy yt-recs --project-ref gukzacuwcaqgkzchghcg
supabase functions deploy spotify-callback --project-ref gukzacuwcaqgkzchghcg
# Migración aplicada vía Management API:
# POST /v1/projects/<ref>/database/query con 20260528000000_spotify_tokens.sql
```

## Spotify: pasos para activar (no incluidos en este commit)

Cuando se quiera completar la integración con UI:

1. **Registrar app** en https://developer.spotify.com/dashboard.
2. **Setear secrets** en Supabase:
   - `SPOTIFY_CLIENT_ID` (obligatorio).
   - `SPOTIFY_CLIENT_SECRET` (opcional; mejor seguridad).
3. **Configurar redirect_uri** en Spotify dashboard:
   - Producción: `https://ritmiq.app/auth/spotify-callback`
   - Dev: `http://localhost:5173/auth/spotify-callback`
4. **Setear `VITE_SPOTIFY_CLIENT_ID`** en `.env` del cliente.
5. **Crear página `/auth/spotify-callback`** que reciba `?code=` y `?state=` y llame `exchangeCodeForToken()`.
6. **Botón "Conectar Spotify"** en `SettingsView` que llame `startSpotifyAuth()`.
7. **Edge function `spotify-recs`** (opcional, para enriquecer scoring híbrido con tracks de Spotify top + recently played).

## Verificación manual

### 6.1 + 6.2
1. Reproducir un track con `ytId` válido.
2. Volver al Home.
3. La fila "Porque escuchaste X" debería tener `byTrackRec.sourcesUsed = ['Last.fm', 'YouTube']`.
4. DevTools → Network: 1 POST a `/functions/v1/recommendations?kind=mix-by-track` + 1 GET a `/functions/v1/yt-recs?seed=<ytId>`.
5. Tracks en posiciones top deberían tener `hybridScore > 1.0` (consensus boost).

### 6.3
- Infraestructura disponible. Sin UI todavía.
- Test directo de la edge function requiere registro Spotify; no se prueba en este commit.

## Limitaciones conocidas

- **Innertube `next`** devuelve la queue de **anonymous YouTube**, no la de YouTube Music. Para resultados más musicales en el futuro, usar `INNERTUBE_CONTEXT_MUSIC` (WEB_REMIX) reservado en `_shared/innertube.ts`.
- **`yt-recs.artist`** viene del canal de YouTube (`shortBylineText`). Es ruido en muchos casos ("Bad Bunny - Topic", "VEVO"). Solo se usa para display; el dedup es por `ytId`.
- **Spotify** sin UI. Infraestructura lista pero requiere setup manual del proyecto Spotify.
- **`yt-recs` cache global**: misma seed = mismo cache para todos los users. Eso es deseado (los videos relacionados de YouTube no dependen del user). Pero el `user_id` se guarda para satisfacer la FK; sería más limpio una tabla `yt_recs_cache` sin FK.

## Estado global del proyecto tras esta fase

- ✓ Fase 0 (5 commits)
- ✓ Fase 1 (5 commits)
- ✓ Fase 2 (6 commits)
- ✓ Fase 3 (5 commits)
- ✓ Fase 4 (9 commits)
- ✓ Fase 5 (4 commits)
- ✓ Fase 6 (3 commits) — **multi-fuente recs**
- ✓ Fase 7 (5 commits)

Queda Fase 8 (jam mode).
