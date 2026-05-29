---
tipo: flujo
capa: flujo
plataforma: ambas
estado: pendiente
ultima-revision: 2026-05-29
tags: [roadmap, spotify, oauth, recomendaciones, futuro]
---

# Activar Spotify OAuth (lectura de historial)

> La infraestructura está construida (Fase 6.3, commit `cccf527`) pero **inert**: falta
> registrar la app en Spotify, setear secrets, crear la página de callback y el botón en
> Settings. Conectar Spotify le da a Ritmiq acceso de **solo lectura** al historial real
> del usuario para enriquecer las recomendaciones y resolver el cold start.

## Por qué se postergó

El objetivo actual es **uso personal estable**. Con 3+ meses de `play_history` propio
dentro de Ritmiq, el beneficio marginal es bajo (~5-10% mejores recs). El valor real
aparece al **distribuir a terceros**, donde resuelve el cold start del usuario nuevo.

## Para qué sirve

- **Cold start**: usuario nuevo conecta Spotify → en 1s Ritmiq conoce sus top 20 artistas,
  top 20 tracks del mes y últimas 50 reproducciones. `auto-genre-mix`, `discover` y
  "Mix por género" funcionan desde el minuto 1.
- **Consensus boost real**: el scoring híbrido ([[hybrid-scoring]]) sube tracks que
  aparecen en 2+ fuentes. Sumar Spotify como tercera fuente (weight `1.1`) afina qué es
  verdaderamente relevante para el usuario, no solo lo popular del género.
- **Mejor catálogo latino/asiático**: Spotify tiene mejor metadata que Last.fm para
  artistas como Bad Bunny, Karol G, BTS, NewJeans.

## Qué NO hace

- **No reproduce** dentro de Ritmiq (la reproducción sigue siendo YouTube).
- **No requiere Premium** (Web API funciona con cuenta gratuita).
- **No scrobblea** lo de Ritmiq hacia Spotify (flow de lectura unidireccional).

## Lo que ya existe

| Componente | Ubicación | Estado |
|---|---|---|
| Tabla `spotify_tokens` | [[spotify_tokens]] · `supabase/migrations/20260528000000_spotify_tokens.sql` | ✅ aplicada en prod |
| Edge `spotify-callback` | [[spotify-callback]] · `supabase/functions/spotify-callback/index.ts` | ✅ deployada (v1 ACTIVE) |
| Lib `spotify-oauth.js` | [[spotify-oauth]] · `packages/ui/src/lib/spotify-oauth.js` | ✅ `startSpotifyAuth`, `exchangeCodeForToken`, `disconnectSpotify`, `getSpotifyConnectionStatus` |

## Lo que falta (checklist de activación)

1. **Registrar app** en https://developer.spotify.com/dashboard.
   - Redirect URIs: `https://ritmiq.app/auth/spotify-callback` (prod) +
     `http://localhost:5173/auth/spotify-callback` (dev).
   - Marcar **Web API**.
   - Anotar **Client ID** y **Client Secret**.
2. **Secrets Supabase**: `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` (recomendado, la
   edge function ya lo soporta opcional para PKCE + secret = más seguro).
   ```bash
   supabase secrets set SPOTIFY_CLIENT_ID=<id> --project-ref gukzacuwcaqgkzchghcg
   supabase secrets set SPOTIFY_CLIENT_SECRET=<secret> --project-ref gukzacuwcaqgkzchghcg
   ```
3. **Cliente**: `VITE_SPOTIFY_CLIENT_ID=<id>` en `.env.production` y `.env.development`.
   Solo el `client_id` va al cliente (es público); el secret NUNCA.
4. **Callback page** `/auth/spotify-callback`: componente `SpotifyCallbackView` que detecta
   `?code=` al boot (paralelo a `recoveryMode` / `SharedView` en [[App|App.jsx]]) y llama
   `exchangeCodeForToken(code, state)`. Limpiar URL con `history.replaceState` tras éxito.
5. **Botón "Conectar Spotify"** en [[ConnectionSection]] (más natural junto a Last.fm que
   sección propia). Usa `startSpotifyAuth()` / `disconnectSpotify()` / `getSpotifyConnectionStatus()`.
6. **(Para efecto observable) edge `spotify-recs`**: lee `spotify_tokens`, refresh si expira,
   llama `/me/top/tracks?time_range=short_term&limit=20`, mapea cada track a YT vía
   `ytSearchOne` ([[innertube]]). Store `stores/spotify-recs.js`. Integrar como tercera
   fuente en `combineSources` del Home ([[Home]]).

> ⚠️ Sin el paso 6, conectar Spotify **no produce ningún cambio visible** — solo guarda el token.

## Trigger para activar

- Decido invitar al primer amigo/familiar (cold start se vuelve crítico), **o**
- Mi escucha real está mayoritariamente fuera de Ritmiq y quiero cerrar ese gap.

## Esfuerzo estimado

- Mínimo (pasos 1-5, sin efecto observable): ~1h yo + 10 min tú.
- Completo (con paso 6, efecto real): ~4-5h yo + 10 min tú.

## Riesgos a vigilar

- **Refresh token revocable**: si el user revoca desde spotify.com/account/apps o no usa la
  app > 1 año. `spotify-recs` debe detectar 401 → toast "Reconecta Spotify".
- **Rate limit**: ~100 calls/min/app (no por user). Mitigar con cache TTL 1h en
  [[recommendation_cache]].
- **Cambiar scopes invalida el refresh token** → el usuario debe reconectar.
- **Privacy**: si distribuyo, la política de privacidad debe mencionar Spotify como tercero.

## Dependencias

- [[hybrid-scoring]] reserva weight `spotify: 1.1` (ya listo).
- [[spotify-oauth]], [[spotify-callback]], [[spotify_tokens]].
- [[innertube]] (`ytSearchOne` para mapear track Spotify → ytId).

## Notas / Changelog

- 2026-05-29: nota creada al postergar la activación (foco en uso personal estable).
