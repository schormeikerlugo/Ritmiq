---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/sign-stream/index.ts
tags: [edge, hmac, auth, streaming, lan]
---

# `sign-stream`

> Firma URLs de stream para el LAN server con HMAC-SHA256. El cliente PWA llama aquí con su JWT; valida RLS (auth.uid() = user_id) y emite URL firmada que el LAN server valida con `STREAM_SIGNING_SECRET` sin consultar Supabase.

## Ubicación
`supabase/functions/sign-stream/index.ts:1` (138 líneas)

## Endpoint

```
POST /sign-stream
Headers: Authorization: Bearer <user JWT>
Body: { trackId, lanBaseUrl, lanBearer? }
Response: { url, expiresAt, ytId }
```

## Por qué existe

- **Centraliza autorización en Supabase**: RLS es único punto de verdad. El LAN server NO consulta Supabase.
- **Elimina service role del Desktop**: el LAN server NO necesita acceso a la DB Postgres.
- **Rotación de secret sin invalidar firmas activas**: TTL 5 min permite rotar el secret sin afectar reproducciones en curso por >5 min.

## TTL

```js
const STREAM_TTL_SEC = 5 * 60;  // 5 minutos
```

Suficiente para que la sesión `<audio>` y los Range requests subsiguientes no caduquen. No extender innecesariamente: ventana corta de exposure si la URL leak.

## Payload HMAC

```js
const payload = `${trackId}|${ytId}|${exp}`;
const sig = HMAC_SHA256(SIGNING_SECRET, payload);
```

`trackId`, `ytId` y `exp` van también en la URL final para que el LAN server los re-construya y verifique.

## URL resultante

```
<lanBaseUrl>/stream/<trackId>?token=<lanBearer>&sig=<sig>&exp=<exp>&yt=<ytId>
```

El `?yt=` permite al LAN server hacer cache HIT por ytId en `shared_audio` sin consultar Supabase.

## Validación RLS

```js
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  global: { headers: { Authorization: authHeader } },  // JWT del usuario
});
const { data: track } = await supabase.from('tracks').select('id, yt_id, source')
  .eq('id', trackId).maybeSingle();
// RLS: solo devuelve si auth.uid() === track.user_id
```

Si el usuario no es dueño del track → `track` es null → 404. Mismo response que "no existe" → no leak de info.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | Auto-inyectada |
| `SUPABASE_ANON_KEY` | Auto-inyectada |
| `STREAM_SIGNING_SECRET` | Secret compartido con [[lan-server]] |

## Invocado desde
- [[lan-client]] → `getSignedStreamUrl(trackId, lanBaseUrl)` con caché de Promise por trackId.

## Validado por
- [[lan-server]] en endpoints `/stream/` y `/download/` cuando hay `?sig=&exp=`.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| TTL muy corto (< 30s) | Range requests al final del track con URL caducada → 401. |
| TTL muy largo (> 1 día) | Ventana de exposure muy grande si la URL leak. |
| Cambiar el payload sin coordinar con [[lan-server]] | Todas las firmas fallan instantáneamente. |
| Service role en lugar de JWT | RLS no aplica → cualquier usuario podría firmar tracks ajenos. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
