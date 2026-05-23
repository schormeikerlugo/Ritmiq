---
tipo: modulo
capa: desktop-main
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/main/cookies-detect.js
tags: [desktop, yt-dlp, cookies, runtime]
---

# `main/cookies-detect.js`

> Autodetecta navegador del usuario para extraer cookies de YouTube, runtime JS (`deno`/`node`) para resolver el "n challenge", y cachea las cookies en un archivo Netscape para evitar re-extracción en cada play.

## Ubicación
`apps/desktop/main/cookies-detect.js:1` (145 líneas)

## Por qué existe

| Problema | Solución de este módulo |
|---|---|
| YouTube bloquea yt-dlp con `Sign in to confirm you're not a bot` desde 2024 | Pasar cookies del browser donde el usuario tiene sesión |
| Desde yt-dlp 2025 las URLs de stream se cifran con "signature challenge" y "n challenge" → solo se resuelven ejecutando JS real. Sin runtime JS, yt-dlp devuelve **solo storyboards** | Pasar `--js-runtimes deno:...` o `node:...` |
| Extraer 1000+ cookies del browser tarda 200-500ms en cada invocación | Cachear el archivo Netscape y refrescar cada 50 min |

## Exports

| Función | Devuelve | Side-effect |
|---|---|---|
| `detectCookiesBrowser()` | nombre browser \| null | — |
| `detectJsRuntime()` | `'<name>:<path>'` \| null | `which` síncrono |
| `getCookieFilePath()` | path en tmpdir | — |
| `exportCookiesToFile(ytdlpBin, browser, maxAgeMs?)` | path \| null | spawn yt-dlp + write file |

## Anatomía del código (snippets clave)

### 1. Orden de detección de navegadores
`apps/desktop/main/cookies-detect.js:26-40`

```js
const candidates = [
  { name: 'firefox',  paths: [join(home, '.mozilla/firefox')] },
  { name: 'chromium', paths: [join(home, '.config/chromium')] },
  { name: 'chrome',   paths: [join(home, '.config/google-chrome')] },
  { name: 'brave',    paths: [join(home, '.config/BraveSoftware/Brave-Browser')] },
  { name: 'edge',     paths: [join(home, '.config/microsoft-edge')] },
  { name: 'vivaldi',  paths: [join(home, '.config/vivaldi')] },
  { name: 'opera',    paths: [join(home, '.config/opera')] },
];
for (const c of candidates) {
  if (c.paths.some((p) => existsSync(p))) return c.name;
}
return null;
```

**Por qué Firefox primero**: en Linux, yt-dlp lee cookies de Firefox sin pedir gnome-keyring. Chrome/Chromium pueden fallar silenciosamente si el keyring no está desbloqueado (típico en sesiones GUI minimalistas, o headless). Firefox = mayor tasa de éxito sin intervención.

**Solo paths Linux**: macOS/Windows usan otras rutas. yt-dlp las resuelve internamente con `--cookies-from-browser`, así que devolver `null` cae al fallback y funciona igual.

### 2. Runtime JS: solo el primer match en PATH
`apps/desktop/main/cookies-detect.js:64-79`

```js
export function detectJsRuntime() {
  const override = process.env.RITMIQ_YTDLP_JS_RUNTIME;
  if (override) {
    const v = override.trim();
    if (v.toLowerCase() === 'none' || v === '') return null;
    return v;
  }
  for (const name of ['deno', 'node']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0) {
      const path = r.stdout.trim();
      if (path) return `${name}:${path}`;
    }
  }
  return null;
}
```

**Por qué `deno` primero**: yt-dlp lo recomienda explícitamente — sandbox más restrictivo, arranca más rápido. Node funciona pero gasta más RAM por invocación.

**Por qué `spawnSync('which')` en el boot**: una sola vez al arrancar, sin overhead repetido. Si el usuario instala Deno después, hay que reiniciar el desktop (aceptable: no es frecuente).

### 3. Cache de cookies en tmpdir + reuso por TTL
`apps/desktop/main/cookies-detect.js:107-144`

```js
export function exportCookiesToFile(ytdlpBin, browser, maxAgeMs = 60 * 60 * 1000) {
  const file = getCookieFilePath();
  // Si el archivo existe y es reciente, reusar.
  try {
    if (existsSync(file)) {
      const age = Date.now() - statSync(file).mtimeMs;
      if (age < maxAgeMs) return Promise.resolve(file);
    }
  } catch { /* ignore */ }

  return new Promise((resolve) => {
    const args = [
      '--cookies-from-browser', browser,
      '--cookies', file,
      '--simulate',
      '--skip-download',
      '--no-warnings',
      '--quiet',
      'https://www.youtube.com/',
    ];
    const child = spawn(ytdlpBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    // ... resuelve con file o null
  });
}
```

**El truco de yt-dlp**: pasar `--cookies-from-browser` y `--cookies <file>` simultáneamente hace que yt-dlp extraiga del browser **y escriba al archivo**. Luego podés llamar yt-dlp solo con `--cookies <file>` (sin tocar el browser) y arranca al instante.

**TTL 1h por default**: balance entre "no spam-eo el browser cada play" y "YouTube rota cookies, no quiero usarlas demasiado viejas". El [[lan-server]] refresca cada 50 min para adelantarse a la rotación.

**Path en `tmpdir()`**: si el sistema reinicia, el cache se borra → próximo arranque regenera. No hace falta cleanup explícito.

## Casos de borde y gotchas

- **Sin browser instalado**: `detectCookiesBrowser` devuelve `null`. yt-dlp intentará sin cookies y la mayoría de videos darán `Sign in to confirm`. Único arreglo: instalar Firefox + login.
- **Browser instalado pero usuario nunca abrió YouTube**: la cookie no existe; yt-dlp dump genera archivo vacío; mismo resultado que sin browser.
- **gnome-keyring locked en sesión GUI**: Chrome/Chromium fallan silenciosamente. Firefox no usa keyring → funciona. Esa es la razón del orden.
- **`which` falla en Windows**: en Windows habría que usar `where` o `npm where`. Hoy el módulo asume Unix; en Windows `detectJsRuntime` devuelve `null` y yt-dlp cae a su comportamiento default (player_client alternativo, menos fiable).
- **Override con path inválido**: si `RITMIQ_YTDLP_JS_RUNTIME=deno:/no/existe`, yt-dlp falla en runtime con mensaje de error confuso. No validamos aquí.

## Dependencias entrantes
- [[ipc]] → construye `ytOpts` al boot.
- [[lan-server]] → ídem, más refresh periódico cada 50 min.

## Dependencias salientes
- `node:fs`, `node:os`, `node:path`.
- `node:child_process` → `spawn`, `spawnSync`.

## Side-effects
- Lee `~/.mozilla/firefox`, `~/.config/<browser>` (solo `existsSync`).
- `spawnSync('which', [name])` un par de veces al boot.
- Spawnea yt-dlp para volcar cookies al `tmpdir`.
- Escribe `/tmp/ritmiq-yt-cookies.txt`.

## Errores manejados
- yt-dlp termina con `code !== 0` → `console.warn` + `resolve(null)`.
- Spawn falla → `console.warn` + `resolve(null)`.
- `statSync` falla (file no existe o permisos) → ignorado.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Reordenar candidates (poner Chrome antes que Firefox) | Linux con keyring locked → cookies no se leen → `Sign in to confirm` masivo. |
| Quitar `--simulate` en el spawn | yt-dlp empieza a descargar el video real al tmpdir; disco lleno y proceso lento. |
| Bajar `maxAgeMs` a < 5 min | Spawneás yt-dlp cada poco rato solo para refrescar cookies → overhead inútil. |
| Soportar solo `deno` (sin node fallback) | Usuarios con Node pero sin Deno pierden reproducción fiable. |

## Notas / Changelog
- 2026-05-22: nivel medio.
