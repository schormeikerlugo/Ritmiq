# @ritmiq/server — Servidor headless 24/7

Corre el **LAN server** de Ritmiq (búsqueda, resolución y stream/descarga de
YouTube vía `yt-dlp`) como un servicio Node **sin Electron**, para no depender
de tener la app desktop abierta.

Comparte toda la lógica con la app desktop a través de **`@ritmiq/server-core`**
(mismo código de servidor, mismos endpoints, misma base SQLite). Aquí solo vive
el bootstrap del entorno headless + una CLI de administración.

## Requisitos del servidor

- **Node LTS 20 o 22** (recomendado). Node muy nuevo (26+) puede no compilar
  `better-sqlite3` todavía.
- **yt-dlp** en el `PATH` (o `RITMIQ_YTDLP_PATH`).
- Un **runtime JS** para yt-dlp: `deno` o `node` (imprescindible para resolver
  el signature challenge de YouTube). Ej: `RITMIQ_YTDLP_JS_RUNTIME=deno:/usr/bin/deno`.
- Opcional: **Firefox** con sesión iniciada en YouTube (cookies del dueño como
  fallback para cuentas que no suben las suyas).

## Instalación

```bash
git clone <repo> /opt/ritmiq && cd /opt/ritmiq
pnpm install            # compila better-sqlite3 para el Node del servidor
```

> Nota sobre `better-sqlite3`: es un módulo nativo. En un monorepo donde también
> vive la app desktop, el binario puede quedar compilado para el ABI de Electron.
> En el servidor (solo Node) `pnpm install` lo compila para Node correctamente.
> Si ves `NODE_MODULE_VERSION mismatch`, ejecuta `pnpm rebuild better-sqlite3`.

## Configuración

Copia `apps/server/.env.example` y ajusta:

```bash
sudo mkdir -p /etc/ritmiq /var/lib/ritmiq
sudo cp apps/server/.env.example /etc/ritmiq/server.env
sudoedit /etc/ritmiq/server.env       # define RITMIQ_STREAM_SIGNING_SECRET, etc.
```

`RITMIQ_STREAM_SIGNING_SECRET` **debe coincidir** con el de la Edge Function
`sign-stream` de Supabase para validar firmas de stream.

## Arranque manual (prueba)

```bash
RITMIQ_DATA_DIR=/var/lib/ritmiq \
RITMIQ_STREAM_SIGNING_SECRET=... \
node apps/server/src/index.js
```

Al arrancar imprime el `access-token` del dueño y el puerto. Verifica salud:

```bash
curl http://localhost:3939/health     # {"ok":true,"service":"ritmiq",...}
```

## systemd (24/7)

```bash
sudo cp apps/server/deploy/ritmiq-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ritmiq-server
journalctl -u ritmiq-server -f        # logs en vivo
```

## Administración (pareo de dispositivos / cuentas)

Un dispositivo (PWA de otra cuenta) se parea contra el servidor con un PIN.
El servidor registra la solicitud en el log; tú la apruebas con la CLI:

```bash
node apps/server/src/cli.js pending             # ver solicitudes
node apps/server/src/cli.js approve <device_id>  # aprobar (emite token)
node apps/server/src/cli.js devices              # dispositivos pareados
node apps/server/src/cli.js revoke <device_id>   # revocar
node apps/server/src/cli.js token                # access-token del dueño
```

## Acceso fuera de casa (Cloudflare Tunnel — Fase 2)

El servidor puede exponerse por un túnel Cloudflare y **publicar su URL** en
Supabase para que la PWA la descubra sola (endpoint `kind='server'`).

1. **Named Tunnel (URL fija, recomendado):** crea un túnel en
   *Cloudflare Zero Trust → Networks → Tunnels*, apúntalo a
   `http://localhost:3939`, y pon su token en `RITMIQ_TUNNEL_TOKEN`.
   Si usas dominio propio, define `RITMIQ_TUNNEL_CUSTOM_URL`.
2. **Publicación automática del endpoint:** define las credenciales del dueño
   (`RITMIQ_OWNER_EMAIL` + `RITMIQ_OWNER_PASSWORD`) para que el servidor haga
   upsert de su URL en `tunnel_endpoints`.

Sin token, el servidor solo es accesible en la LAN (o define
`RITMIQ_TUNNEL_MODE=quick` para una URL temporal `*.trycloudflare.com`).

## Selección de servidor en los clientes (Fase 2)

En *Ajustes → Servidor de reproducción* el usuario elige el **Modo de conexión**:

- **Automático:** usa tu PC (desktop) en la misma red y cae al servidor 24/7.
- **Servidor 24/7:** prioriza el servidor casero.
- **Más rápido:** compite ambos por ping y usa el primero que responda.

El indicador "Conectado a" muestra el endpoint activo (LAN / PC túnel / Servidor).

## Cuentas propias de YouTube por usuario (Fase 3)

Cada usuario pareado puede reproducir con **su propia cuenta de YouTube**.
Sin cuenta propia, se usan las cookies del dueño del servidor (fallback).

Dos vías (en *Ajustes → Acceso remoto → Usar mi cuenta de YouTube*):

- **Opción A — Login por navegador (recomendada, 3b):** el servidor levanta
  un contenedor con un navegador remoto (noVNC) bajo demanda. El usuario abre
  la ventana, inicia sesión en YouTube, y el servidor captura sus cookies
  automáticamente. Requiere construir la imagen del contenedor de login:

  ```bash
  docker build -f apps/login-agent/Dockerfile -t ritmiq-login:latest .
  ```

  Y que el servidor tenga acceso al socket de Docker (ya montado en
  `docker-compose.yml`) para lanzarlo. El contenedor se autodestruye al
  terminar (login OK o timeout de ~5 min).

  > **Aviso al usuario:** usa una cuenta de YouTube **sin verificación en dos
  > pasos (2FA)** o secundaria. El 2FA/captcha puede complicar el flujo y las
  > cookies dan acceso a la sesión.

- **Opción B — Subida manual:** el usuario exporta su `cookies.txt` (extensión
  «Get cookies.txt LOCALLY») y lo sube.

- **Opción C — Aportar cookies desde el desktop (Fase 4):** al aprobar un
  dispositivo desde la app desktop, el aprobador puede subirle **sus propias
  cookies de YouTube del navegador del desktop** (botón *Aprobar + mis
  cookies*). Reutiliza el login del navegador, sin noVNC ni archivos.

Las cookies se guardan **cifradas** (`devices.cookies_blob`). Para cifrado en
reposo real en headless, define `RITMIQ_COOKIES_KEY` (si no, fallback 0600).

## Control de acceso y administración (Fase 3c)

**Allowlist (`RITMIQ_ALLOWED_USERS`):** lista de cuentas Supabase de confianza,
separadas por coma. Un dispositivo cuya cuenta esté en la lista se **auto-aprueba
sin PIN** al parear. Fuera de la lista → aprobación manual.

**Panel web de administración:** disponible en `https://<servidor>/admin`.
- Pega el **access-token del dueño** (el que imprime el servidor al arrancar,
  o `ritmiq-admin token`).
- Muestra solicitudes pendientes (con su PIN) y dispositivos pareados; permite
  aprobar / rechazar / revocar desde el móvil sin SSH. Marca qué dispositivos
  tienen su propia cuenta de YouTube vinculada.

Alternativa por consola (SSH): `ritmiq-admin pending|approve|reject|devices|revoke|token`.

## Identidad verificada y administración por cuenta (Fase 4)

**Identidad Supabase (JWT).** El servidor verifica el token de sesión de Supabase
para confiar en la identidad del cliente. El `supabase_user_id` sale del `sub`
del JWT firmado — **nunca** del body — así que un cliente no puede suplantar a
otra cuenta. Con `VITE_SUPABASE_URL` definido, la firma se verifica contra el
**JWKS** del proyecto (ES256, sin secreto). Con proyectos HS256 legacy, define
`RITMIQ_SUPABASE_JWT_SECRET`.

- **Login requerido para parear:** por defecto, `/pair` exige un JWT válido
  (`RITMIQ_REQUIRE_AUTH_FOR_PAIR`, ON cuando hay verificación). Sin sesión → 401.

**Administración de dos niveles:**

- **Dueño (owner):** con el access-token del servidor, gestiona **todos** los
  dispositivos (panel web `/admin`, CLI `ritmiq-admin`, o desde la app desktop).
  Controla qué **cuentas** acceden al servidor (allowlist / aprobación).
- **Sub-admin por cuenta:** un usuario autenticado (JWT) gestiona **solo sus
  propios dispositivos** (mismo `supabase_user_id`) desde la app desktop
  (*Ajustes → Conexión → Dispositivos pareados*, con el servidor 24/7
  configurado). No ve ni puede tocar los dispositivos de otras cuentas (403).

Endpoints (auth por cuenta): `GET /devices/mine`, `POST /devices/{approve,
reject,revoke,rename,cookies}`. El owner usa el access-token; el sub-admin, su
JWT de Supabase.

> **Nota de arquitectura:** exigir la app desktop para parear NO es un control
> de seguridad (un atacante usaría `curl`). La seguridad real es **JWT
> verificado + aprobación del dueño**. El desktop es la vía cómoda para aprobar
> y aportar cookies.

## Migrar el caché de archivos del desktop al servidor

El caché de audio (`shared-audio/`) es **local a cada host**: lo que descarga el
desktop no lo ve el servidor y viceversa. Para llevar tu caché acumulado del
desktop al servidor 24/7 (y servirlo al instante, sin re-descargar):

1. En el desktop, empaqueta solo los `.m4a` (servibles en iOS) del caché
   compartido (`~/.config/@ritmiq/desktop/shared-audio/`) y transfiérelos al
   servidor (tar sobre SSH).
2. Extráelos en el `shared-audio/` del servidor (dentro del volumen de datos,
   p.ej. `/data/shared-audio`).
3. Re-indexa por nombre de archivo con el script incluido:

   ```bash
   # dentro del contenedor / entorno del servidor
   node apps/server/src/import-shared-cache.js
   ```

   Registra cada `<ytId>.m4a` en la tabla `shared_audio`. Es **idempotente**
   (re-ejecutarlo solo actualiza tamaños/rutas) y omite formatos no servibles
   (`.opus`, etc.) para no romper reproducción en móviles.

> Solo se migran `.m4a`/`.mp4`. Los `.opus` (descargas del owner en desktop) no
> se migran porque iOS/Safari no los reproduce; se re-descargarán como m4a en el
> servidor la primera vez que se pidan.

## Nota de seguridad (noVNC)

La pantalla de login (noVNC) hoy no lleva contraseña y es **efímera** (se apaga
tras ~5 min o al vincular) y de **un solo dispositivo**. Exponla solo en tu LAN
o a través del túnel. Endurecerla con autenticación es una mejora futura.
