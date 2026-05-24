---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-24
archivo: supabase/functions/publish-track-meta/index.ts
tags: [supabase, edge-function, p2p, knowledge-base]
created: 2026-05-24
deployed: gukzacuwcaqgkzchghcg
---

# publish-track-meta — Canoniza metadata al diccionario global

> **Tabla destino:** [[tracks_global]]
> **Auth:** Bearer JWT de usuario real (`auth.getUser`)
> **Rate-limit:** 100 upserts/min/user (in-memory)
> **Source:** `supabase/functions/publish-track-meta/index.ts`

## Propósito

Recibe del cliente (tras una reproducción exitosa o una descarga) un snapshot de metadata del track. Lo limpia, valida, y lo canoniza en [[tracks_global]] con política first-write-wins.

## Endpoint

```
POST /functions/v1/publish-track-meta
Authorization: Bearer <user_jwt>
apikey: <project_anon_key>
Content-Type: application/json
```

Body:
```json
{
  "ytId": "wXz4CzACD1E",
  "title": "Inuyasha Ending 1 - My Will",
  "artist": "Dream",
  "album": "Inuyasha OST",         // opcional
  "coverUrl": "https://i.ytimg.com/vi/...",  // opcional
  "durationSeconds": 248            // opcional
}
```

Respuesta:
```json
{ "ok": true, "ytId": "wXz4CzACD1E", "action": "canonicalized" }
// action puede ser: "canonicalized" | "incremented" | "incremented_after_race"
```

## Flujo interno

1. Validar `Authorization: Bearer <jwt>` con `userClient.auth.getUser()`. Rechaza ANON_KEY con 401.
2. Rate-limit per `user.id`: 100 ops/min en window deslizante in-memory.
3. Validar campos:
   - `ytId` debe matchear `/^[\w-]{11}$/`.
   - `title` y `artist` no vacíos.
   - Strings truncados a 500 chars.
   - `durationSeconds` en rango [1, 86400].
4. **Defense-in-depth:** aplicar [[clean-track-meta]] `cleanYoutubeTitle({ rawTitle, rawUploader: rawArtist })`. Idempotente; si ya viene limpio del search-youtube, no cambia nada. Si viene de un cliente legacy o de `publishTrackMetaFromMain` (que lee SQLite con datos previos al fix), se canoniza limpio.
5. Hacer `SELECT yt_id, contribution_count FROM tracks_global WHERE yt_id = $1`.
6. Si **EXISTE** → `UPDATE` solo `last_seen_at = now()`, `contribution_count = +1`. NO sobreescribe title/artist/etc (canonicalización).
7. Si **NO EXISTE** → `INSERT` con todos los campos.
8. **Race condition handling:** si el INSERT lanza error 23505 (otro request ganó entre nuestro select y nuestro insert), reintentamos como UPDATE.

## Por qué exige JWT de usuario real (no ANON_KEY)

- Anti-spam: cualquiera con el ANON_KEY (que viaja en `.env.production` del cliente) no debería poder ensuciar `tracks_global`.
- Permite rate-limit per-user efectivo.
- Permite eventualmente añadir reputación, ban de spammers, etc.

## Triggers

- **Renderer:** `packages/ui/src/lib/use-player.js:publishTrackMeta` fire-and-forget tras `backend.play()` exitoso. Dedupe in-memory por sesión (Set de ytIds ya publicados).
- **Desktop main:** `apps/desktop/main/lan-server.js:publishTrackMetaFromMain` invocado desde `ipc.js:library:download` tras yt-dlp exitoso. Dedupe in-memory module-level.

## Stats observables

Cliente: `packages/ui/src/lib/use-player.js:metaPublishStats` (exported):

```js
{
  attempts: number,
  successes: number,
  failures: number,
  lastSuccessAt: number | null,
  lastError: { message, at } | null,
}
```

Visible en `Settings → Diagnóstico → "Diccionario global Ritmiq"`.

## Cross-references

- [[tracks_global]] — tabla destino
- [[clean-track-meta]] — utility de cleaning aplicado
- [[search-youtube]] — Edge que lee del mismo diccionario
- [[p2p-knowledge-sharing]] — flujo completo
