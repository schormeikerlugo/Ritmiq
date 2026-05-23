---
tipo: modulo
capa: yt
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/yt/src/ytdlp-wrapper.js
tags: [yt, ytdlp, streaming, descarga, bot-check]
---

# `yt/ytdlp-wrapper.js`

> Wrapper Node.js para `yt-dlp`. Expone `getStreamUrl`, `getMetadata`, `search` y `downloadAudio`. Implementa la **cascada de player_clients** con lógica anti-bot para el escenario YouTube 2025+.

## Ubicación
`packages/yt/src/ytdlp-wrapper.js:1` (370 líneas)

## Solo proceso main de Electron

**No importar desde renderer ni PWA.** Requiere `node:child_process.spawn`. La PWA usa la Edge Function [[resolve-stream]] de Supabase para el mismo efecto.

## `YtDlpOpts`

```js
/**
 * @typedef {Object} YtDlpOpts
 * @property {string}  [binary]              Path al binario. Default: 'yt-dlp'
 * @property {string}  [cookiesFromBrowser]  --cookies-from-browser (lento, 200-500ms)
 * @property {string}  [cookiesFile]         Archivo Netscape pre-exportado (rápido, 0ms).
 *                                           Tiene PRIORIDAD sobre cookiesFromBrowser.
 * @property {string}  [jsRuntime]           --js-runtimes (ej. 'node:/usr/bin/node')
 *                                           IMPRESCINDIBLE desde yt-dlp 2025.
 * @property {boolean} [preferM4a]           Selector m4a-first para iOS Safari.
 * @property {string}  [cacheDir]            --cache-dir persistente (ahorra 300-1000ms 2ª+ call)
 */
```

## Exports

| Función | Devuelve | Cuándo |
|---|---|---|
| `getStreamUrl(idOrUrl, opts?)` | `Promise<string>` | Play en streaming (no descarga) |
| `getMetadata(idOrUrl, opts?)` | `Promise<YtMetadata>` | Info del video sin descargar |
| `search(query, opts?)` | `Promise<YtMetadata[]>` | Búsqueda en YouTube |
| `downloadAudio(idOrUrl, outputPath, opts?)` | `Promise<void>` | Descarga offline |

## Anatomía del código (snippets clave)

### 1. `run()`: spawn con handle de cancelación
`packages/yt/src/ytdlp-wrapper.js:51-72`

```js
function run(args, opts = {}) {
  const bin = opts.binary ?? 'yt-dlp';
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const promise = new Promise((resolve, reject) => {
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error(`yt-dlp killed (${signal})`));
        return;
      }
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr}`));
    });
  });
  // Exponer el handle del proceso para poder matarlo si se cancela.
  promise.kill = () => { try { child.kill('SIGTERM'); } catch {} };
  return promise;
}
```

**Por qué `promise.kill`**: la cola de prioridades de [[lan-server]] necesita poder cancelar un spawn de yt-dlp en curso cuando llega un request de mayor prioridad. Adjuntar el método `kill` al Promise permite que el scheduler lo llame sin necesidad de mantener el `child` por separado.

**Por qué tratar SIGTERM/SIGKILL como reject**: si la cancelación fue intencional, el caller no debe re-intentar. Emitir un error específico permite que el cascade loop distinga "cancelado" de "error retryable".

### 2. La cascada de player_clients — el snippet más crítico
`packages/yt/src/ytdlp-wrapper.js:139-237`

```js
// ═══════════════════════════════════════════════════════════════
// CASCADA DE PLAYER_CLIENTS — Anti-bot + signature solving (2025+)
// ═══════════════════════════════════════════════════════════════
//
// ⚠️ MANTENIMIENTO: si la reproducción se rompe con uno de estos errores,
// REVISA ESTA CASCADA antes de tocar otra cosa:
//   • "Requested format is not available"
//   • "Signature solving failed" / "n challenge solving failed"
//   • "Sign in to confirm you're not a bot"
//   • "Only images are available for download" (solo storyboards)
//
// PARADOJA CRÍTICA:
//   CON cookies + android_vr → yt-dlp SALTA android_vr (no soporta cookies)
//   SIN cookies + android_vr → YouTube 429 / bot check
//   CON cookies + JS runtime + client normal → ✅

const hasJs = Boolean(opts?.jsRuntime);
const attempts = hasJs
  ? [
      { fmt, client: 'default',     useCookies: true  },
      { fmt, client: 'web_safari',  useCookies: true  },
      { fmt, client: 'mweb',        useCookies: true  },
      { fmt, client: 'tv_embedded', useCookies: true  },
      { fmt: 'bestaudio', client: null, useCookies: true },
      { fmt, client: 'android_vr',  useCookies: false },
      { fmt, client: 'ios_music',   useCookies: false },
    ]
  : [
      { fmt, client: 'android_vr',  useCookies: false },
      { fmt, client: 'ios_music',   useCookies: false },
      { fmt, client: 'mweb',        useCookies: true  },
      { fmt: 'bestaudio', client: null, useCookies: true },
    ];

let lastErr;
for (const a of attempts) {
  try {
    const out = await run(build(a.fmt, a.client, a.useCookies ?? true), opts);
    return out.trim().split('\n')[0];
  } catch (err) {
    lastErr = err;
    const msg = err?.message ?? '';
    const retryable =
      /Requested format is not available/i.test(msg) ||
      /Sign in to confirm/i.test(msg)               ||
      /Only images are available/i.test(msg)         ||  // signature solving falló
      /Signature solving failed/i.test(msg)          ||
      /n challenge/i.test(msg);
    if (!retryable) throw err; // error definitivo — no seguir intentando
  }
}
throw lastErr;
```

**La paradoja central (2025+)**:

| Condición | Resultado |
|---|---|
| CON cookies + `android_vr` | yt-dlp **salta** android_vr (no soporta cookies) → cae a clients web que sin JS fallan |
| SIN cookies + `android_vr` | YouTube devuelve 429 o bot check |
| CON cookies + JS runtime + client normal | ✅ Funciona — el runtime resuelve el n-challenge |

Por eso la rama `hasJs = true` usa clients normales CON cookies primero, y guarda `android_vr` SIN cookies como último recurso. La rama `hasJs = false` invierte: `android_vr`/`ios_music` SIN cookies son el primer recurso.

**Por qué `retryable` errors**: errors como "Video unavailable" o "Private video" son definitivos — no tiene sentido probar otro client. Solo los errors de formato/firma/bot-check justifican el retry.

**Cómo diagnosticar si la cascada falla**:

```bash
# 1. Verificar versión (debe ser < 30 días)
<bin> --version

# 2. Replicar manualmente
<bin> --cookies-from-browser firefox \
    --js-runtimes node:/usr/bin/node \
    --extractor-args "youtube:player_client=default" \
    -F "https://www.youtube.com/watch?v=<ID>"
```

Ver `docs/playback-troubleshooting.md` para más planes (PO Token, youtubei.js, etc.).

### 3. Selector de formato: `preferM4a` vs `bestaudio`
`packages/yt/src/ytdlp-wrapper.js:86-92`

```js
const fmt = opts?.preferM4a
  ? 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio'
  : 'bestaudio';
```

**Por qué dos selectores**:
- `bestaudio`: Electron/Chromium decodifica opus/webm sin problema. Es el más permisivo y funciona con todos los clients.
- `bestaudio[ext=m4a]/...`: iOS Safari **no** decodifica opus/webm. Si el track no tiene m4a disponible en ese client → `"Requested format is not available"` → el cascade intenta el siguiente client. Más intentos, misma URL final.

**`preferM4a: true`** se activa cuando:
- [[lan-server]] construye el `ytOpts` con `preferM4a: true` (todos los streams del LAN server van a la PWA).
- Las descargas vía LAN `/download/` en [[lan-server]] también usan `format: 'm4a'` explícitamente en `downloadAudio`.

### 4. `search`: `--flat-playlist` y NDJSON
`packages/yt/src/ytdlp-wrapper.js:281-311`

```js
export async function search(query, opts = {}) {
  const max = opts.max ?? 10;
  const out = await run(
    [
      `ytsearch${max}:${query}`,  // "ytsearch15:bohemian rhapsody"
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--skip-download',
    ],
    opts
  );
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      results.push({ id: j.id, title: j.title, ... });
    } catch { /* ignorar líneas no-JSON */ }
  }
}
```

**Por qué `--flat-playlist`**: sin este flag, yt-dlp resuelve la metadata completa de cada resultado incluyendo resolución de streams — mucho más lento. Con `--flat-playlist`, solo lista IDs, títulos y thumbnails. Para search es suficiente; la URL del stream se resuelve en `getStreamUrl` cuando el usuario clickea.

**Por qué NDJSON (newline-delimited JSON)**: `--dump-json` en modo flat-playlist emite un JSON por línea (no un array). Parseo línea por línea es más robusto ante stdout parcial.

### 5. `downloadAudio`: `--newline` para progreso
`packages/yt/src/ytdlp-wrapper.js:331-364`

```js
child.stdout.on('data', (b) => {
  const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(b.toString());
  if (m && opts.onProgress) opts.onProgress(parseFloat(m[1]));
});
```

**Por qué regex sobre stdout en lugar de eventos**: yt-dlp no tiene API de eventos. La única forma de obtener progreso es parsear las líneas que imprime. `--newline` fuerza a que cada update de progreso sea una línea separada (sin carriage return).

## Casos de borde y gotchas

- **Cascada sin JS runtime**: los clients `android_vr` e `ios_music` son los únicos que no necesitan signature solving. Si YouTube les aplica bot-check también (tendencia en 2025), la app queda sin reproducción. La única solución es instalar Deno o Node.
- **`out.trim().split('\n')[0]`**: yt-dlp con `-g` puede devolver múltiples líneas si hay múltiples formatos. Tomamos solo la primera (la mejor según el selector). Si la primera es inválida y la segunda no lo es, la perdemos.
- **Cookies de browser durante búsqueda (`search`)**: `search` también recibe `opts` con cookies/runtime pero el `run` de search NO usa la cascada de clients. Si la búsqueda también empieza a requerir login (tendencia), habrá que portarle la cascada.
- **`getMetadata` single client list**: usa `--extractor-args youtube:player_client=default,web_safari,...` todos en una invocación. Si falla un client, yt-dlp prueba el siguiente internamente, sin cascada externa.
- **SIGTERM durante download largo**: `promise.kill()` SIGTERM y yt-dlp deja el archivo parcial en disco. El caller ([[ipc]] y [[lan-server]]) debería limpiar archivos parciales en el catch. Hoy no lo hace.

## Performance y costes

| Operación | Latencia típica | Bloqueante |
|---|---|---|
| `getStreamUrl` con cache + JS runtime | 1-3s | spawn yt-dlp |
| `getStreamUrl` sin cache, primer arranque | 3-8s | spawn yt-dlp + player.js download |
| `getMetadata` | 500ms-2s | spawn yt-dlp |
| `search` (15 resultados) | 800ms-2s | spawn yt-dlp |
| `downloadAudio` (track ~5MB) | 5-30s | spawn yt-dlp + ffmpeg |

El cache de yt-dlp (`--cache-dir <userData>/yt-dlp-cache`) reduce el boot de 3-8s a 1-3s a partir de la 2ª invocación por sesión.

## Dependencias entrantes
- [[ipc]] — todos los handlers `yt:*`, `library:download`.
- [[lan-server]] — `/yt/search`, `/yt/metadata`, `/stream/`, `/download/`.

## Dependencias salientes
- `node:child_process.spawn`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar el orden de la cascada (poner android_vr primero CON cookies) | yt-dlp salta android_vr → cae a clients web sin JS → "Only images are available". |
| Quitar `android_vr` de la cascada | Sin JS runtime, no hay fallback → play completamente roto. |
| Añadir `useCookies: true` a `android_vr` | yt-dlp silenciosamente lo salta → misma cascada pero un slot desperdiciado. |
| Cambiar `--flat-playlist` a resolución completa en search | Search tarda 10-30x más; 15 resultados en 20-60s. |
| `out.trim().split('\n')[0]` → `[1]` | Se toma el segundo formato en lugar del mejor → posible fallo de codec. |
| Quitar `promise.kill` | La cola de prioridades de [[lan-server]] no puede cancelar spawns de baja prioridad → slots saturados. |
| Cambiar `bestaudio` a `bestaudio[ext=opus]` como default | Falla en clients como android_vr que no tienen opus → "Requested format is not available" masivo. |

## Notas / Changelog
- 2026-05-22: nivel pleno (crítico: toda la reproducción pasa por aquí).
