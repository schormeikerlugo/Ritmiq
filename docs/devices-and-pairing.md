# Devices, pairing y cookies por dispositivo

Documento de referencia tras la migracion Fase 1-6 (mayo 2026). Reemplaza
el modelo HMAC + Edge `sign-stream` por **device tokens locales**.

## Conceptos

- **Desktop**: el PC que corre Ritmiq AppImage. Tiene yt-dlp, Cloudflare
  Tunnel y SQLite local. Es la autoridad de autorizacion: decide quien
  puede usar sus recursos.
- **Device**: cada PWA que se conecta al desktop (un iPhone, un iPad, un
  navegador). Cada device tiene un `device_id` (UUID) y un `device_token`
  (secret) emitido tras el pareo.
- **Access token (owner)**: token Bearer compartido para herramientas
  internas y la propia app desktop. Sigue existiendo en
  `<userData>/access-token.txt`. NO se reparte a otros dispositivos.
- **Signing secret**: ya no se usa para autorizar audio. Persiste en
  `<userData>/signing-secret.txt` solo por compat con codigo legado.

## Flujo de pareo

```
PWA                                              Desktop
 │                                                 │
 │ (1) genera device_id (UUID, localStorage)       │
 │ (2) genera PIN aleatorio 4 digitos              │
 │                                                 │
 ├─ POST /pair {                                   │
 │     device_id, display_name,                    │
 │     supabase_user_id?, pin                      │
 │   } ──────────────────────────────────────────▶ │
 │                                                 │ (3) si supabase_user_id
 │                                                 │     coincide con otro device
 │                                                 │     approved → auto-aprueba
 │                                                 │     (Decision #5)
 │                                                 │
 │ ◀─── 200 { status:'approved', device_token } ── │
 │                                                 │
 │  o si no:                                       │
 │ ◀─── 200 { status:'pending' } ───────────────── │
 │                                                 │ (4) inserta en pair_requests
 │                                                 │     dispara notificacion
 │                                                 │     nativa al owner
 │                                                 │
 │ (5) polling GET /pair/status?device_id=X        │
 │     cada 2.5s hasta 10 min                      │
 ├─────────────────────────────────────────────▶ │
 │                                                 │ (6) owner ve PIN en UI,
 │                                                 │     verifica con PWA,
 │                                                 │     click "Aprobar"
 │                                                 │     -> approveDevice()
 │                                                 │     emite device_token
 │                                                 │
 │ ◀─── { status:'approved', device_token } ─────  │
 │                                                 │
 │ (7) persiste device_token en localStorage       │
 │     usa como Bearer en todas las requests       │
```

## Auto-pareo por cuenta Supabase (Decision #5)

Cuando llega `POST /pair` con `supabase_user_id` que ya tiene **algun**
device approved en este desktop, el nuevo device se aprueba sin PIN.
Beneficio: Ana parea su iPhone, luego al abrir la PWA en su iPad solo
debe pulsar "Conectar" y queda autorizada al instante.

Trade-off documentado: si el owner revoca el iPad, el iPhone sigue
funcionando — son devices independientes con tokens distintos. Pero si
se compromete la cuenta Supabase de Ana, cualquier nueva sesion que
abra el atacante auto-parea. Por eso el owner ve siempre el evento como
notificacion + entrada en activity log.

## Cookies por device

Cada device tiene su columna `cookies_blob` en `devices`:

- **Subida**: `POST /cookies/upload { cookies_b64 }` con device_token.
- **Cifrado**: Electron `safeStorage` (keyring del OS). Fallback a
  plaintext con warning si no esta disponible (Linux sin gnome-keyring).
- **Uso**: el LAN server escribe a `<userData>/device-cookies/<id>.txt`
  con 0600 antes de pasarlo a yt-dlp via `--cookies`.
- **Fallback**: si un device NO tiene cookies, se usan las del owner
  (las que `cookies-detect.js` exporta del browser local). Esto puede
  contaminar la cuenta YouTube del owner — la UI advierte al user.

**Limitacion iPhone**: iOS Safari no permite a una PWA leer cookies de
`youtube.com` (same-origin + HttpOnly). Los users iPhone-only tienen que
aceptar fallback al owner o enviarse el archivo desde un PC.

## Endpoints del LAN server

Todos requieren auth excepto `/health` y `/pair*`:

| Endpoint | Auth | Notas |
|---|---|---|
| `GET /health` | publico | sanity check |
| `POST /pair` | publico, rate-limited 5/min por IP | crea pair_request o auto-aprueba |
| `GET /pair/status` | publico | polling del device |
| `POST /cookies/upload` | device_token only | requiere device aprobado |
| `GET /stream/:trackId?yt=ytId` | device_token o owner | cache local → shared → yt-dlp |
| `GET /download/:trackId?yt=ytId` | device_token o owner | yt-dlp full download + cache shared |
| `GET /yt/search` | device_token o owner | usa cookies del device si las tiene |
| `GET /yt/metadata` | idem | |
| `GET /yt/prewarm` | idem | |
| `GET /spotify/playlist` | idem | scraping del embed |
| `GET /shared-cache` | owner only | stats |
| `DELETE /shared-cache` | owner only | solo borra archivos del cache, no descargas del owner |

## Activity log

Tabla `device_activity` con eventos por device. Rotacion a **5 dias**
(prune al arrancar + cada 12h). Acciones registradas:
`pair_auto_approved`, `cookies_upload`, `search`, `stream`,
`stream_shared`, `download`, `download_cached`.

UI desktop: `Settings → Dispositivos conectados → [Actividad]` muestra
los ultimos 50 eventos por device. Util para auditar abuso.

## Operaciones administrativas

### Rotar signing-secret (legacy)
Modelo nuevo no lo necesita, pero si en algun momento se reactiva HMAC:

```bash
NEW=$(openssl rand -hex 32)
echo -n "$NEW" > ~/.config/@ritmiq/desktop/signing-secret.txt
chmod 600 ~/.config/@ritmiq/desktop/signing-secret.txt
supabase secrets set STREAM_SIGNING_SECRET="$NEW" --project-ref XXX
# reiniciar AppImage + redeploy Edge
```

### Revocar todos los devices

```bash
sqlite3 ~/.config/@ritmiq/desktop/ritmiq.sqlite \
  "UPDATE devices SET status='revoked', revoked_at=datetime('now')"
```

Los devices ven 401 en su proximo request y deben re-pareear.

### Regenerar access-token del owner

Desde la app: Settings → "Token de acceso para clientes externos" →
"Regenerar token".

### Borrar cache compartido manualmente

Settings → Caché compartido entre cuentas → "Limpiar caché compartido".
**Preserva** archivos en `<userData>/audio/` (descargas explicitas del
owner via la app desktop). Solo borra `<userData>/shared-audio/`.

## Migracion big-bang (Decision #6)

La version nueva es **incompatible** con la PWA vieja:
- PWAs viejas usan Edge `sign-stream` que ya no esta deployada (Fase 4).
- La PWA nueva no entiende firmas HMAC; va por device_token directo.

Procedimiento de actualizacion:
1. Build de AppImage + PWA nuevos (`pnpm run build`).
2. Despliega PWA a Vercel/Cloudflare Pages.
3. Owner instala el AppImage nuevo. Al arrancar: regenera signing-secret
   si no existia, mantiene access-token y devices.
4. Cada user en su PWA hace pull-to-refresh para que el SW cargue la
   version nueva.
5. Cada user va a Settings → "Conectar un desktop", introduce la URL
   del tunnel, pulsa "Conectar".
6. Owner ve la pair request en su UI con el PIN, lo compara y aprueba.
7. Tras la primera aprobacion, devices subsiguientes del mismo
   supabase_user_id se auto-aprueban.
