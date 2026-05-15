# Playback Troubleshooting — yt-dlp + YouTube

Este documento explica qué hacer **cuando la reproducción de tracks deja
de funcionar** en Ritmiq Desktop. YouTube cambia su anti-bot/anti-scraping
con frecuencia y la solución suele estar en `packages/yt/src/ytdlp-wrapper.js`.

> Si llegaste aquí desde un comentario en el código: el síntoma típico es
> reproducción rota con uno de estos errores en el terminal del proceso main:
>
> - `Requested format is not available` (aunque uses `-f bestaudio`)
> - `Signature solving failed` / `n challenge solving failed`
> - `Sign in to confirm you're not a bot`
> - `Only images are available for download` (solo storyboards)
> - `WARNING: Only deno is enabled by default; to use another runtime add --js-runtimes`

---

## Causa raíz (estado al 2025-Q2)

Desde mediados de 2024, yt-dlp **exige un runtime JavaScript** (Deno por
defecto, opcionalmente Node) para resolver las firmas cifradas de URL
("signature challenge" / "n challenge") que YouTube añadió a la mayoría
de los `player_client`. Sin runtime JS instalado:

| `player_client` | Sin JS runtime | Con JS runtime |
|---|---|---|
| `android_vr` | ✅ Sin firmar (pero `--cookies-from-browser` lo skip-ea) | ✅ |
| `ios_music` | ✅ Sin firmar | ✅ |
| `tv_embedded` | ❌ Solo storyboards | ✅ |
| `web_safari`  | ❌ Solo storyboards | ✅ |
| `default` (web) | ❌ Solo storyboards | ✅ |
| `mweb` | ⚠️ A veces | ✅ |

### Paradoja clave (descubierta empíricamente)

| Combinación | Resultado |
|---|---|
| Cookies + `android_vr` | ❌ yt-dlp skip-ea android_vr porque "no soporta cookies" → cae a clients web → fallan sin JS |
| Sin cookies + `android_vr` | ⚠️ Funciona a veces, otras HTTP 429 / bot check |
| Cookies + JS runtime + cualquier client normal | ✅ **Camino óptimo** |

Por eso la cascada cambia de estrategia según haya o no `jsRuntime` en
`YtDlpOpts`. Si lo hay, va por clients web normales CON cookies. Si no,
va por `android_vr`/`ios_music` SIN cookies.

### Instalación recomendada

```bash
# Arch
sudo pacman -S nodejs    # ya lo tienes si trabajas en proyectos JS
# o
sudo pacman -S deno      # recomendado por yt-dlp
```

La app autodetecta `node` y `deno` en PATH al arrancar. Verás en el log:
`[lan-server] yt-dlp js-runtime: node:/usr/bin/node`.

---

## Diagnóstico paso a paso

Localiza el binario que la app está usando:

```bash
ls -la ~/.config/@ritmiq/desktop/bin/yt-dlp
# o
ls -la apps/desktop/bin/yt-dlp
```

Anota su path como `$YTDLP`.

### Test 1 — Versión

```bash
$YTDLP --version
```

Si es de hace > 30 días, actualízalo desde Settings → "Update yt-dlp"
(o copia el del sistema si tu distro lo tiene fresco).

### Test 2 — ¿La cascada actual funciona en CLI?

```bash
$YTDLP --cookies-from-browser firefox \
  --extractor-args "youtube:player_client=android_vr" \
  -F "https://www.youtube.com/watch?v=<ID_QUE_FALLA>"
```

- Si **lista formatos m4a/opus** → el cliente sigue vivo. El bug está en la app.
- Si **lista solo storyboards** → YouTube tapó `android_vr`. Salta a "Plan B".

### Test 3 — ¿Cookies fiables?

```bash
$YTDLP --cookies-from-browser firefox -F "https://www.youtube.com/watch?v=<ID>"
$YTDLP --cookies-from-browser chrome  -F "https://www.youtube.com/watch?v=<ID>"
```

- Si Firefox dice "Extracted 0 cookies" → no estás logueado a YouTube allí.
- Si Chrome dice "cookies no longer valid... rotated" → cierra Chrome, ábrelo
  y loguéate de nuevo. Las cookies se rotan al detectar acceso externo.

---

## Plan B — Instalar runtime JS

Cuando `android_vr` deje de funcionar, instala Deno y todos los clientes
revivirán:

```bash
# Arch
sudo pacman -S deno

# macOS
brew install deno

# Debian/Ubuntu
curl -fsSL https://deno.land/install.sh | sh
```

Luego añade `--js-runtimes deno` a los args base en
`packages/yt/src/ytdlp-wrapper.js`:

```js
const baseArgs = [
  '-g',
  '--no-playlist',
  '--no-warnings',
  '--no-check-certificates',
  '--skip-download',
  '--js-runtimes', 'deno',   // ← añadir esta línea
];
```

Eso desbloquea `tv_embedded`, `web_safari`, `default`, etc.

---

## Plan C — PO Token vía plugin

Si yt-dlp empieza a exigir **PO Token (Proof-of-Origin)** para todos los
clientes (anuncio oficial de YouTube en 2024), instala el plugin
`bgutil-ytdlp-pot-provider`. Es la solución más robusta a largo plazo:

```bash
# El plugin se ofrece como server HTTP o módulo Node
# https://github.com/Brainicism/bgutil-ytdlp-pot-provider
```

Requiere empaquetar otro binario con la app. Documentado pero no
implementado todavía.

---

## Plan D — Migrar a `youtubei.js` (Innertube directo)

Librería Node pura que habla el API privado Innertube como lo hace la app
de YouTube Music. No depende de yt-dlp. Trade-offs:

- ✅ Cero binarios externos
- ✅ Evade detección de manera diferente
- ❌ Refactor grande de `packages/yt`
- ❌ Hay que mantener compatibilidad con metadata/search también

Considerar solo si los Planes A/B/C no son sostenibles.

---

## Clientes alternativos a probar (catálogo)

Si tienes que reescribir la cascada, estos son los `player_client` que
yt-dlp soporta a la fecha. El comportamiento cambia mes a mes:

| Cliente | Notas |
|---|---|
| `android_vr` | **Actualmente la mejor opción.** Sin firmas, sin PO token. |
| `ios_music` | Bueno para tracks de YouTube Music. |
| `mweb` | Mobile web. A veces evita bot check sin firmas. |
| `tv` | Reciente, está como `tv_simply` o `tv` según versión. |
| `tv_embedded` | Antes era el rey. Hoy requiere JS runtime. |
| `web_safari` | Expone m4a (útil para iOS Safari) pero requiere JS runtime. |
| `web_embedded` | Vídeos embebidos en otros sitios. |
| `android_creator` | Cuenta de YouTube Studio. |
| `ios_creator` | Idem en iOS. |
| `default` / `web` | El default que YouTube más bloquea. |

Comando útil para listar los soportados por tu binario:

```bash
$YTDLP --extractor-args "youtube:player_client=help" -F "https://youtu.be/dQw4w9WgXcQ" 2>&1 | grep -A2 player_client
```

---

## Referencias

- yt-dlp wiki — EJS / JS runtimes:
  https://github.com/yt-dlp/yt-dlp/wiki/EJS
- yt-dlp wiki — Cookies:
  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies
- bgutil-ytdlp-pot-provider:
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider
- youtubei.js:
  https://github.com/LuanRT/YouTube.js

---

## Historial de regresiones de YouTube vs Ritmiq

Mantén este registro al día cuando arregles algún incident:

| Fecha | Síntoma | Causa | Solución aplicada |
|---|---|---|---|
| 2026-05-14 | "Requested format is not available" para todos los tracks | yt-dlp 2026.03 exige JS runtime; cookies de Firefox sí evaden bot check pero no resuelven signatures; clientes `tv_embedded`/`web_safari`/`default` retornan solo storyboards | Cascada `android_vr,ios_music,tv_embedded,web_safari,default` en `ytdlp-wrapper.js`. Cookies auto-detectadas por `cookies-detect.js`. |
| 2026-05-14 (b) | Misma síntoma persistía aún con cascade. Test CLI reveló `Skipping client "android_vr" since it does not support cookies` | Pasar `--cookies-from-browser` hace que yt-dlp salte `android_vr` y caiga a clients web que requieren JS runtime | Añadido `detectJsRuntime()` en `cookies-detect.js`. Pasamos `--js-runtimes node:/usr/bin/node` en `YtDlpOpts.jsRuntime`. Cascada bifurcada: con JS runtime usa clients web + cookies; sin JS runtime usa `android_vr`/`ios_music` SIN cookies. |
