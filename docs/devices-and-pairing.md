# Devices, pairing y cookies por dispositivo

Documento de referencia para Modelo Y (rama `feat/device-pairing`,
implementacion 2026-05). Cohabita con el modelo HMAC + `sign-stream`
original — ambos paths estan activos durante la transicion.

## Conceptos

- **Desktop**: el PC que corre Ritmiq AppImage. Tiene yt-dlp, Cloudflare
  Tunnel y SQLite local. Es la autoridad de autorizacion: el owner
  aprueba cada device manualmente con PIN.
- **Device**: cada PWA (iPhone, iPad, navegador en PC) que se conecta al
  desktop. Tiene `device_id` (UUID en localStorage) y `device_token`
  (secret de 32 bytes emitido por el desktop al aprobar).
- **Access token (owner)**: token Bearer del propio PC en
  `<userData>/access-token.txt`. NO se reparte a otros dispositivos.
- **Signing secret (legacy)**: para HMAC vs Edge `sign-stream`. Persiste
  en `<userData>/signing-secret.txt`. Sigue activo como path paralelo
  para PWAs que aun no pareearon.

## Flujo de pareo (PIN siempre)

```
PWA                                              Desktop
 │                                                 │
 │ (1) genera device_id (UUID, localStorage)       │
 │ (2) genera PIN aleatorio 4 digitos              │
 │                                                 │
 ├─ POST /pair {                                   │
 │     device_id, display_name,                    │
 │     supabase_user_id?, pin,                     │
 │     cookies_b64?                                │
 │   } ──────────────────────────────────────────▶ │
 │                                                 │
 │ ◀─── 200 { status:'pending' } ───────────────── │
 │                                                 │ (3) inserta en pair_requests
 │                                                 │     dispara notificacion
 │                                                 │     nativa al owner
 │                                                 │
 │ (4) polling GET /pair/status?device_id=X        │
 │     cada 2.5s hasta 10 min                      │
 ├─────────────────────────────────────────────▶ │
 │                                                 │ (5) owner ve PIN en UI,
 │                                                 │     verifica con PWA,
 │                                                 │     click "Aprobar"
 │                                                 │     -> approveDevice()
 │                                                 │     emite device_token
 │                                                 │
 │ ◀─── { status:'approved', device_token } ─────  │
 │                                                 │
 │ (6) persiste device_token en localStorage       │
 │     usa como Bearer en todas las requests       │
```

**Auto-pair DESACTIVADO en esta rama.** Cada device requiere aprobacion
manual con PIN. El bloque de auto-aprobacion por `supabase_user_id` esta
comentado en `devices.js` — restaurar si se reactiva.

## Cookies por device

Cada device tiene su columna `cookies_blob` en la tabla `devices`:

- **Subida**: `POST /cookies/upload { cookies_b64 }` con device_token.
- **Cifrado**: Electron `safeStorage` (keyring del OS). Fallback a
  plaintext con warning si no esta disponible.
- **Uso**: el LAN server escribe a `<userData>/device-cookies/<id>.txt`
  con 0600 antes de pasarlo a yt-dlp via `--cookies`.
- **Fallback**: si un device NO tiene cookies, se usan las del owner
  (las que `cookies-detect.js` exporta del browser local de Firefox).
  Esto puede contaminar la cuenta YouTube del owner (search history del
  device se mezcla con la del owner). La UI lo advierte.

**Limitacion iPhone**: iOS Safari no permite a una PWA leer cookies de
`youtube.com`. Los users iPhone-only aceptan el fallback a las cookies
del owner. Android puede exportar cookies via flow manual.

## Endpoints del LAN server

| Endpoint | Auth | Notas |
|---|---|---|
| `GET /health` | publico | sanity check |
| `POST /pair` | publico, rate-limit 5/min/IP | crea pair_request |
| `GET /pair/status` | publico | polling del device |
| `POST /cookies/upload` | device_token solo | requiere device aprobado |
| `GET /stream/:trackId?yt=ytId` | device_token, owner, o sig HMAC | cache local → shared → yt-dlp |
| `GET /download/:trackId?yt=ytId` | idem | full m4a + cache shared |
| `GET /yt/search` | idem | usa cookies del device si subidas |
| `GET /yt/metadata` | idem | |
| `GET /yt/prewarm` | idem | |
| `GET /spotify/playlist` | idem | |
| `GET /shared-cache` | owner solo | stats |
| `DELETE /shared-cache` | owner solo | borra archivos del cache (no descargas owner) |

## Cache compartido (shared_audio)

Indexado por `yt_id` (no por trackId). Cualquier device aprobado puede:

1. Solicitar `/stream/<trackId>?yt=<ytId>` — el desktop:
   - SQLite local → si owner descargo → archivo.
   - shared_audio HIT por ytId → archivo.
   - Miss → yt-dlp resolve + proxy live.
2. Solicitar `/download/<trackId>?yt=<ytId>` — el desktop:
   - shared_audio HIT por ytId → archivo (instantaneo).
   - Miss → yt-dlp download → indexa en shared_audio → archivo.

**Llenado del cache** en esta rama: solo via descargas explicitas (no
durante streaming). El tee de streaming queda para una rama posterior
(`feat/streaming-cache`).

## Activity log

Tabla `device_activity` con eventos por device. Rotacion **5 dias**
(prune al arrancar + setInterval cada 12h).

Acciones registradas:
- `search` — busqueda yt-dlp.
- `stream` — reprodujo un ytId (no cache).
- `stream_shared` — reprodujo desde shared_audio.
- `download` — descarga nueva via yt-dlp.
- `download_cached` — descarga desde shared_audio.
- `cookies_upload` — subio cookies.

UI desktop: `Ajustes → Dispositivos conectados → [Actividad]` muestra
los ultimos 50 eventos por device.

## Operaciones administrativas

### Revocar un device

Settings desktop → click "Revocar" en la fila del device. El device ve
401 en su proxima request y debe volver a pareear.

```bash
sqlite3 ~/.config/@ritmiq/desktop/ritmiq.sqlite \
  "UPDATE devices SET status='revoked', revoked_at=datetime('now') WHERE device_id = '<id>'"
```

### Revocar todos los devices

```bash
sqlite3 ~/.config/@ritmiq/desktop/ritmiq.sqlite \
  "UPDATE devices SET status='revoked', revoked_at=datetime('now')"
```

### Borrar cache compartido

Settings → Cache compartido → "Limpiar cache compartido". **Preserva**
archivos en `<userData>/audio/` (descargas explicitas del owner). Solo
borra `<userData>/shared-audio/`.

### Regenerar access-token del owner

Settings desktop → "Token de acceso para clientes externos" →
"Regenerar token". NO afecta a devices pareados (tienen sus propios
tokens).

## Coexistencia con HMAC

En esta rama, el desktop acepta TRES paths de autorizacion para
`/stream/*` y `/download/*`:

1. **Firma HMAC** (`?sig=...&exp=...`): PWA llamo a Edge `sign-stream`.
2. **device_token** (Bearer): PWA ya pareada en Modelo Y.
3. **ACCEPT_UNSIGNED** (compat): track existe en SQLite del owner.

Los tres coexisten para no romper PWAs viejas durante la transicion.
Cuando todos los users hayan pareado, se puede:
- Quitar `RITMIQ_ACCEPT_UNSIGNED_STREAMS=true` de `.env.production`.
- Borrar Edge `sign-stream` y el path HMAC en `lan-server.js`.
