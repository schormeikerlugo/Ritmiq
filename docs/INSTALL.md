# Guía de instalación y despliegue de Ritmiq

Esta guía te lleva desde un sistema limpio hasta tener Ritmiq corriendo en
desktop, móvil y con backend en Supabase Cloud, incluyendo el sistema de
recomendaciones basado en Last.fm.

> Estimado de tiempo: 30–45 minutos si seguís todos los pasos.

---

## 0. Requisitos previos

### Software

| Herramienta | Versión mínima | Verificación |
|---|---|---|
| Node.js | 20.x | `node -v` |
| pnpm | 9.x | `pnpm -v` (o `npm install -g pnpm`) |
| Git | cualquiera | `git --version` |
| Python 3 | 3.10+ | requerido por `yt-dlp` embebido |
| psql | 14+ | opcional, útil para aplicar migraciones manualmente |

### Cuentas externas (todas gratis)

1. **Supabase** — https://supabase.com — backend, auth, DB, edge functions, storage.
2. **Cloudflare** — https://dash.cloudflare.com — Tunnel para exponer LAN
   server del PC a la PWA fuera de casa (opcional pero recomendado).
3. **Last.fm** — https://www.last.fm/api/account/create — API key para
   recomendaciones (gratis, sin verificación de email exigente).
4. **Vercel / Netlify / Cloudflare Pages** — opcional, para hospedar la PWA.

---

## 1. Clonar e instalar dependencias

```bash
git clone <repo-url> ritmiq
cd ritmiq
pnpm install
```

Esto descarga el monorepo y compila las dependencias nativas (`better-sqlite3`,
`cloudflared`, `yt-dlp` para tu plataforma).

---

## 2. Crear el proyecto en Supabase Cloud

1. Entrá a https://supabase.com/dashboard y "New project".
2. Apuntá el **Project Ref** (ej. `gukzacuwcaqgkzchghcg`) — está en la URL.
3. Guardá la **Database password** que aparece en la creación. La vas a
   necesitar para `db push`. Si la perdés podés resetearla en Settings →
   Database → "Reset database password".
4. En Project Settings → API, copiá:
   - `Project URL` (ej. `https://<ref>.supabase.co`).
   - `anon public` key.
   - `service_role` key (NO la expongas en el cliente).

### Vincular CLI local

```bash
# Si no tenés CLI global, usá npx — funciona idéntico.
npx supabase login
# Te abre el navegador, autorizás.

npx supabase link --project-ref <tu-ref-aquí>
# Te va a pedir la database password.
```

---

## 3. Aplicar migraciones SQL

Las migraciones están en `supabase/migrations/`. Son siete archivos que
construyen el esquema completo (tracks, playlists, history,
recommendations, tunnel endpoints, etc).

### Método A — CLI

```bash
SUPABASE_DB_PASSWORD='<tu-db-password>' npx supabase db push --linked --include-all
```

Si la red local bloquea el puerto 5432 (común con varios ISP), forzá el
pooler transaccional en 6543:

```bash
SUPABASE_DB_PASSWORD='<pwd>' npx supabase db push \
  --db-url "postgresql://postgres.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:6543/postgres" \
  --include-all
```

> Reemplazá `<region>` por tu region (ej. `us-east-2`).

### Método B — Manual con psql

```bash
export PGPASSWORD='<tu-db-password>'
HOST=aws-1-us-east-2.pooler.supabase.com
USER=postgres.<tu-ref>

for f in supabase/migrations/*.sql; do
  echo "→ $f"
  psql -h "$HOST" -p 6543 -U "$USER" -d postgres -v ON_ERROR_STOP=1 -f "$f"
done

# Registrar como aplicadas para futuros push
psql -h "$HOST" -p 6543 -U "$USER" -d postgres -c \
  "INSERT INTO supabase_migrations.schema_migrations (version) VALUES
   ('20260507000000'),('20260508000000'),('20260509000000'),
   ('20260510000000'),('20260511000000'),('20260513000000'),
   ('20260514000000') ON CONFLICT DO NOTHING;"
```

### Método C — Dashboard SQL Editor

Para sistemas sin acceso a psql ni CLI:
1. Supabase Dashboard → SQL Editor → "New query".
2. Pegá cada archivo de `supabase/migrations/` en orden y "Run".

### Verificación

```sql
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
-- Deberías ver 7 versiones (de 20260507... a 20260514...).
```

---

## 4. Configurar API key de Last.fm

### 4.1 Obtener la key

1. Crear cuenta en https://www.last.fm/join
2. Ir a https://www.last.fm/api/account/create
3. Llenar el formulario:
   - **Application name**: Ritmiq (o lo que quieras)
   - **Description**: Personal music app
   - **Application homepage URL**: cualquier URL válida (puede ser localhost)
   - **Callback URL**: dejar vacío (solo lectura)
4. Copiar la **API key** y el **Shared secret**.

### 4.2 Cargar en Supabase Secrets

Creá el archivo `supabase/.env` (está en .gitignore, no se commitea):

```bash
LASTFM_API_KEY=<tu-api-key>
LASTFM_SHARED_SECRET=<tu-shared-secret>
```

Subí los secrets:

```bash
npx supabase secrets set --env-file supabase/.env
```

Verificá:

```bash
npx supabase secrets list
# Debería mostrar LASTFM_API_KEY entre los listados.
```

### 4.3 Deploy de la Edge Function

```bash
npx supabase functions deploy recommendations
npx supabase functions deploy resolve-stream  # si no estaba deployada
npx supabase functions deploy search-youtube  # si no estaba deployada
npx supabase functions deploy match-spotify   # si no estaba deployada
```

Verificá que respondan:

```bash
curl https://<ref>.supabase.co/functions/v1/recommendations?kind=similar-artist&seed=test \
  -H "Authorization: Bearer fake"
# Debe devolver: {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}
# (es lo esperado: significa que la función está viva y validando auth)
```

---

## 5. Configurar variables de entorno del cliente

Creá `apps/pwa/.env.local` y `apps/desktop/.env.local`:

```
VITE_SUPABASE_URL=https://<tu-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<tu-anon-key>
```

> **Nunca** pongas `service_role` aquí — esa solo va en secrets de Supabase.

---

## 6. Configurar Cloudflare Tunnel (opcional, para PWA fuera de casa)

El Tunnel permite que tu PWA en el iPhone (sirvada por Vercel/HTTPS) hable
con tu PC desde fuera de la WiFi. Sin Tunnel solo funciona en LAN local.

### 6.1 Generar token de tunnel

1. Cloudflare Dashboard → Zero Trust → Networks → Tunnels → "Create tunnel".
2. Elegí nombre (ej. `ritmiq-pc`).
3. En "Choose your environment", copiá el **tunnel token** completo
   (cadena base64 larga). NO ejecutes el comando, solo el token.
4. En "Public hostnames":
   - Subdomain: lo que prefieras o dejarlo vacío.
   - Domain: usá `.trycloudflare.com` para gratis.
   - Service type: `HTTP` — URL: `http://localhost:3939`.

> Alternativa más simple: `cloudflared tunnel --url http://localhost:3939`
> (genera un URL `.trycloudflare.com` temporal sin necesidad de cuenta CF).
> Ritmiq desktop tiene una opción "Tunnel rápido" en Settings que hace
> esto automáticamente.

### 6.2 Configurar en Ritmiq desktop

1. Abrir Ritmiq desktop.
2. Settings → "Conexión remota".
3. Pegar el token de tunnel.
4. Activar "Iniciar tunnel al arrancar".

Esto registra el URL del tunnel en la tabla `tunnel_endpoints` de tu
Supabase. La PWA del móvil lo lee automáticamente al iniciar sesión con
el mismo usuario.

---

## 7. Compilar y ejecutar

### Desktop (Electron)

```bash
# Dev (con hot reload)
pnpm --filter @ritmiq/desktop dev

# Build de producción (AppImage / dmg / exe según OS)
pnpm --filter @ritmiq/desktop build
# Output en apps/desktop/release/
```

### PWA

```bash
# Dev local
pnpm --filter @ritmiq/pwa dev
# Abre http://localhost:5173

# Build de producción
pnpm --filter @ritmiq/pwa build
# Output en apps/pwa/dist/
```

### Deploy PWA a Vercel

```bash
cd apps/pwa
npx vercel --prod
# Configurá las env vars VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
# en el dashboard de Vercel para tu proyecto.
```

O subí manualmente `apps/pwa/dist/` a cualquier hosting estático.

---

## 8. Instalar la PWA en el iPhone

1. Abrí el URL público de Vercel desde Safari.
2. Tocá el botón "compartir" → "Añadir a pantalla de inicio".
3. La PWA se instala como app standalone.
4. Login con tu cuenta Supabase.
5. Si Ritmiq desktop está corriendo con Tunnel activo, la PWA se conecta
   automáticamente; verás el indicador "Tunnel" o "LAN" en la parte
   superior derecha.

---

## 9. Verificar que las recomendaciones funcionan

1. En PWA o Desktop, buscá y reproducí ~5 canciones distintas, dejando
   cada una >30 segundos sonando (umbral para que cuenten en historial).
2. Esperá ~30 segundos.
3. Recargá el Home.
4. Deberías ver las filas:
   - "Reproducidos recientemente" (inmediato).
   - "Tus más escuchados" (inmediato).
   - "Tus artistas" (inmediato).
   - "Porque escuchaste X" (tras 1–3s mientras carga Last.fm).
   - "Mix de [Artista]" (tras 1–3s).
   - "Para descubrir" (tras 2–5s; necesita más datos en historial).

Si una fila no aparece, lo más probable es que Last.fm no tenga datos
para ese artista (común con artistas locales muy de nicho) — la fila
queda oculta sin error.

---

## 10. Troubleshooting

### Las recomendaciones nunca aparecen

```bash
# Ver logs de la edge function en tiempo real
npx supabase functions logs recommendations --tail
```

Buscá errores como `LASTFM_API_KEY no configurada` o `lastfm 403`.

### "Sin conexión con tu PC" en PWA

- Verificá que Ritmiq desktop esté corriendo.
- En Settings de Ritmiq desktop, verificá que "Tunnel" muestre estado
  "Connected" y un URL `*.trycloudflare.com`.
- Verificá que la tabla `tunnel_endpoints` en Supabase tenga una fila
  con tu user_id (Dashboard → Table editor → tunnel_endpoints).

### `db push` falla con timeout en puerto 5432

Tu ISP bloquea 5432 (común). Usá el pooler transaccional 6543:

```bash
SUPABASE_DB_PASSWORD='<pwd>' npx supabase db push \
  --db-url "postgresql://postgres.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:6543/postgres" \
  --include-all
```

### `db push` falla con `prepared statement already exists`

Estás en pooler 6543 (transaction mode) que no soporta prepared
statements. Aplicá los archivos manualmente con `psql` (ver §3 Método B).

---

## Apéndice: Resumen de costes

| Servicio | Plan | Coste | Límites relevantes |
|---|---|---|---|
| Supabase | Free | $0 | 500 MB DB, 1 GB storage, 500K edge function requests/mes |
| Cloudflare Tunnel | Free | $0 | Sin límite, hostname `*.trycloudflare.com` |
| Last.fm API | Free | $0 | ~5 req/s por IP (mitigado por cache 12h) |
| Vercel | Hobby | $0 | 100 GB bandwidth/mes |

Con buen uso de cache (TTL 12h en `recommendation_cache`), una instancia
soporta cómodamente **50–200 usuarios activos diarios sin costo alguno**.

Para escalar más:
- Supabase Pro ($25/mes): 8 GB DB, 100 GB storage, 2M edge function reqs.
- Last.fm: la key sigue siendo la misma; el rate limit se distribuye
  entre toda tu base de usuarios.
