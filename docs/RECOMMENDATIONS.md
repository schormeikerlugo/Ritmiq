# Sistema de recomendaciones (Home estilo Spotify)

Documentación técnica del subsistema de recomendaciones musicales de Ritmiq.

## Arquitectura general

```
┌──────────────────────────────────────────────────────────────────┐
│                          Cliente (PWA / Desktop)                  │
│                                                                   │
│  Home.jsx ──► useHistoryStore ──► play_history (snapshot por play)│
│      │                                                            │
│      ├──► selectores puros (recent, top, continue, top-artists)  │
│      │                                                            │
│      └──► useRecommendationsStore.fetch(kind, seed)               │
│                          │                                        │
└──────────────────────────┼────────────────────────────────────────┘
                           │ HTTPS + JWT
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Edge Function `recommendations`              │
│                                                                   │
│  1. Valida JWT del usuario.                                       │
│  2. Lee `recommendation_cache` (TTL 12h).                         │
│  3. Si cache fresca → devuelve.                                   │
│  4. Si no:                                                        │
│     a. Llama a Last.fm (similar-artist / similar-track / etc).    │
│     b. Para cada candidato, busca en YouTube vía Innertube.       │
│     c. Devuelve lista de tracks `yt:<id>` reproducibles.          │
│     d. Persiste en `recommendation_cache`.                        │
│                                                                   │
└─────┬─────────────────────────────────────┬───────────────────────┘
      │                                     │
      ▼                                     ▼
┌──────────────────┐               ┌──────────────────────────────┐
│  Last.fm API     │               │  YouTube Innertube API       │
│  (read-only,     │               │  (sin OAuth, endpoint público│
│  con API key)    │               │   que usa la web de YouTube) │
└──────────────────┘               └──────────────────────────────┘
```

## Componentes

### Base de datos

#### `play_history` (extendida en Fase 1)
Cada evento es un snapshot autocontenido del track al momento de reproducir.
Permite registrar también tracks efímeros que el usuario nunca guardó en
biblioteca.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK auth.users |
| `track_id` | uuid \| null | FK opcional a `tracks` |
| `yt_id` | text \| null | ID YouTube del track |
| `title` | text | snapshot |
| `artist` | text \| null | snapshot |
| `cover_url` | text \| null | snapshot |
| `duration_seconds` | int \| null | snapshot |
| `duration_played_seconds` | int \| null | cuánto escuchó realmente |
| `source` | text \| null | `youtube` \| `local` |
| `played_at` | timestamptz | when |

Índices:
- `idx_play_history_user(user_id, played_at desc)` — recent feed.
- `idx_play_history_user_yt(user_id, yt_id, played_at desc) where yt_id is not null`.

RLS: solo el owner puede leer/escribir.

#### `artist_tags`
Cache global de top-tags por artista (Last.fm). Read-only público; solo la
edge function (service role) escribe.

#### `recommendation_cache`
| Columna | Tipo |
|---|---|
| `cache_key` | text PK (sha256 de userId+kind+seed) |
| `user_id` | uuid |
| `kind` | text (`similar-artist`, `mix-by-track`, `genre-mix`, `discover`) |
| `seed` | text \| null |
| `payload` | jsonb |
| `refreshed_at` | timestamptz |

TTL: 12 horas. RLS por owner.

### Cliente

#### `packages/ui/src/stores/history.js`
- `load()` — pull desde Supabase tras login.
- `record(track, playedSeconds)` — inserta tras umbral (30s o 30% de la
  duración). Dedupe 60s/fingerprint.
- `flushOffline()` — reintenta cola IndexedDB al recuperar red.
- Selectores puros: `selectRecentTracks`, `selectTopTracks`,
  `selectTopArtists`, `selectContinueListening`.

#### `packages/ui/src/lib/use-player.js`
Engancha al `timeupdate` para llamar a `useHistoryStore.record()` cuando el
usuario consume >30s o >30% de la duración. Solo una vez por track por
sesión (ref interno `playConsumedRef`).

#### `packages/ui/src/stores/recommendations.js`
Llama a la Edge Function `recommendations`. Cache en memoria por sesión.
Convierte `RecTrack` del servidor en `Track`-like reproducible con id
efímero `yt:<id>`.

#### `packages/ui/src/components/Home/`
- `Home.jsx` — pantalla principal con 8 secciones:
  1. Hero compacto (Biblioteca + playlists).
  2. Continúa escuchando.
  3. Reproducidos recientemente.
  4. Tus más escuchados.
  5. Porque escuchaste [tu último track].
  6. Mix de [tu artista #1].
  7. Para descubrir.
  8. Tus artistas.
  9. Descargados (offline).
- `HomeRow.jsx` — fila horizontal scrollable con `scroll-snap`.
- `TrackCard.jsx` — card vertical con cover cuadrado + play overlay.
- `ArtistCard.jsx` — card circular para artistas.

Filas vacías retornan `null` automáticamente — sin ruido en cuentas
nuevas.

Click en card → reproduce ese track + carga toda la fila como cola
(estilo Spotify). Botón "Reproducir" del header lanza desde el primero.

### Edge Function `recommendations`

Ubicada en `supabase/functions/recommendations/index.ts`.

#### Endpoint
```
GET /functions/v1/recommendations?kind=<kind>&seed=<seed>

Headers:
  Authorization: Bearer <user JWT>
  apikey:        <ANON_KEY>
```

#### Kinds soportados

| Kind | Seed | Descripción |
|---|---|---|
| `similar-artist` | nombre del artista | Top tracks de artistas similares vía Last.fm `artist.getSimilar`. |
| `mix-by-track` | `<artist>::<title>` | Tracks similares vía `track.getSimilar`. |
| `genre-mix` | tag/género | `tag.getTopTracks`. |
| `discover` | — | Para cada uno de tus 3 artistas top, busca similares que NO estén en tu biblioteca y trae top tracks. |

#### Respuesta
```json
{
  "kind": "similar-artist",
  "seed": "Bad Bunny",
  "tracks": [
    {
      "ytId": "...",
      "title": "...",
      "artist": "...",
      "thumbnail": "...",
      "duration": 211,
      "reason": "Similar a Bad Bunny"
    }
  ],
  "generatedAt": "2026-05-14T10:00:00Z",
  "cached": false
}
```

#### Variables de entorno requeridas

| Secret | Obligatoria | Descripción |
|---|---|---|
| `LASTFM_API_KEY` | sí | API key gratuita de Last.fm |
| `LASTFM_SHARED_SECRET` | no | Reservado para Fase 3 (scrobble). |
| `SUPABASE_URL` | auto | inyectado |
| `SUPABASE_ANON_KEY` | auto | inyectado |
| `SUPABASE_SERVICE_ROLE_KEY` | auto | inyectado |

## Cuotas y escala (Last.fm)

### Límites oficiales de Last.fm API

Last.fm publica estos límites para endpoints de **lectura** (que son los
que usamos: `artist.getSimilar`, `track.getSimilar`, `tag.getTopTracks`,
`artist.getTopTracks`, `artist.getTopTags`):

- **5 requests por segundo por IP de origen.**
- No hay cuota diaria documentada para read-only.
- Solo `auth.getSession`, scrobble y "love track" tienen rate limits
  estrictos (no los usamos).

Fuente: https://www.last.fm/api/intro

### Cómo escala con muchos usuarios

Nuestra arquitectura mitiga el límite en tres niveles:

1. **Cache server-side de 12h por usuario+kind+seed.**
   - Primer usuario que reproduce "Bad Bunny" dispara las llamadas a
     Last.fm. Los siguientes (mismo usuario, mismo seed) reciben cache
     instantánea durante 12h sin tocar Last.fm.

2. **Cache de memoria del cliente por sesión.**
   - Aun antes de pegar al server cache, una recarga del Home en la misma
     sesión reusa el resultado en RAM.

3. **Las llamadas salen desde IPs de Supabase Edge** (us-east, etc.) y
   se comparten entre todos los usuarios del proyecto. Esto significa
   que el límite de 5 req/s aplica al **total agregado de tu Supabase
   project**, no por usuario.

### Estimación de carga

Cada Home fresh (cache miss) genera aproximadamente:
- `similar-artist`: 1 call `artist.getSimilar` + hasta 8 `artist.getTopTracks` + 8 búsquedas Innertube → 9 calls Last.fm.
- `mix-by-track`: 1 call `track.getSimilar` + 12 búsquedas Innertube → 1 call Last.fm.
- `discover`: 3× `artist.getSimilar` + hasta 10 `artist.getTopTracks` → 13 calls Last.fm.

**Total por usuario primera vez**: ~23 calls Last.fm + ~30 búsquedas Innertube.
**Cada 12h después**: 0 calls (todo desde cache).

Con N usuarios concurrentes refrescando Home fresh al mismo tiempo, el
pico sería N × 23 calls comprimidas en ~5–10 segundos. El límite de 5
req/s significa que aproximadamente:

| Usuarios concurrentes fresh | Tiempo total estimado | Riesgo de 429 |
|---|---|---|
| 1 | 5–8 s | ninguno |
| 5 | 20–30 s | bajo |
| 20 | 1.5–2 min | medio (algunos 429) |
| 100+ | > 8 min | alto |

### ¿Hasta cuántos usuarios soporta sin problemas?

Asumiendo distribución uniforme de uso (los usuarios no entran todos al
mismo segundo):

- **< 50 usuarios activos diarios**: sin problemas. La cache 12h cubre
  el 95% de los Home loads.
- **50–500 usuarios activos**: aceptable. Pueden aparecer 429 esporádicos
  que el cliente maneja silenciosamente (la fila simplemente queda vacía
  y se reintenta al cabo de unos minutos).
- **>1000 usuarios activos**: empieza a ser problema. Soluciones:
  - Registrar **una API key por usuario** (Last.fm permite esto: cada
    usuario en Ritmiq se asocia su propia key opcional).
  - Pre-computar recomendaciones en un cron job nocturno por usuario
    (sigue siendo agregado, pero distribuye en el tiempo).
  - Saltar a un servicio de pago como Spotify Web API (recomendaciones
    de mayor calidad + cuotas más altas, requiere OAuth por usuario).

### ¿La API key debe ser secreta?

Sí, en el sentido de que la dejamos como **Supabase secret** y no en
código. Pero:
- Las API keys de Last.fm read-only no autenticán acciones del usuario
  (no permiten escribir en su cuenta). Solo identifican la aplicación.
- Si filtramos la key, alguien podría hacer queries a Last.fm
  "haciéndose pasar por Ritmiq", lo cual no expone datos de nuestros
  usuarios. Lo peor es que consuman nuestra cuota.

## Roadmap futuro

Ideas exploradas en `docs/arquitectura.md` y aún no implementadas:

### Fase 3 — Refinamiento
- **`artist_tags` activo**: edge function `enrich-tags` que para cada
  artista del usuario llama `artist.getTopTags` y lo cachea. Habilita
  filas "Mix de [Género real]" en lugar de usar nombre de artista.
- **Daily Mix programado** con cron de Supabase (`pg_cron`): regenerar
  cache a las 4am de cada usuario, así el Home matutino siempre tiene
  contenido fresco sin esperar al primer load.
- **Hora del día**: heurística para sugerir música suave en la noche o
  energética en la mañana.

### Fase 4 — Multi-fuente
- **YouTube Music recomendaciones** vía Innertube (sin Last.fm).
- **Spotify Web API**: requiere OAuth por usuario, retorno: mucho mejor
  cobertura latina + audio-features.
- **Combinar sources** con scoring híbrido.
