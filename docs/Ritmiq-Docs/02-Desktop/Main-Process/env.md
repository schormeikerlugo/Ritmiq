---
tipo: modulo
capa: desktop-main
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/main/env.js
tags: [desktop, env, configuracion]
---

# `main/env.js`

> Parser minimal de `.env.production` / `.env.development` para el proceso main de Electron. Sin dependencias externas (no usa `dotenv`).

## Ubicación
`apps/desktop/main/env.js:1` (95 líneas)

## Por qué no `import.meta.env`

El main no pasa por Vite. Solo el renderer ve variables `VITE_*` via `import.meta.env`. Las variables del main (`RITMIQ_*`, service role keys, secrets) se cargan acá manualmente.

## Exports

### `loadEnv(): void`

Lee el archivo `.env` apropiado y popula `process.env` **sin sobreescribir** variables ya presentes (override externo gana).

## Selección del archivo

| Contexto | Archivo |
|---|---|
| `app.isPackaged === true` | `.env.production` |
| `app.isPackaged === false` | `.env.development` |

Búsqueda en este orden (primera coincidencia gana):

1. `process.cwd() / <filename>` (monorepo root cuando se lanza con `pnpm dev:desktop`).
2. `process.resourcesPath / <filename>` (AppImage / dmg / exe).
3. `__dirname/../../../<filename>` (relativo al main file).
4. `__dirname/../../../../<filename>` (fallback más profundo).

## Variables esperadas (no exhaustivo)

| Variable | Consumidor |
|---|---|
| `RITMIQ_STREAM_SIGNING_SECRET` | [[lan-server]] valida firmas HMAC. |
| `RITMIQ_ACCEPT_UNSIGNED_STREAMS` | [[lan-server]] modo compat. |
| `RITMIQ_YTDLP_COOKIES_BROWSER` | [[cookies-detect]] override del browser. |
| `RITMIQ_YTDLP_JS_RUNTIME` | [[cookies-detect]] override del runtime JS. |
| `SUPABASE_*` | Cliente Supabase server-side. |

Ver [[Variables-de-Entorno]] para la convención global.

## Anatomía del código (snippet clave)

### Parser minimal y no-override
`apps/desktop/main/env.js:74-91`

```js
export function loadEnv() {
  const file = findEnvFile();
  if (!file) {
    console.warn('[env] no .env file found — variables RITMIQ_* sin cargar');
    return;
  }
  try {
    const content = readFileSync(file, 'utf8');
    const parsed = parseEnv(content);
    let loaded = 0;
    for (const [k, v] of Object.entries(parsed)) {
      // No overridear si ya está seteado (env externa gana).
      if (process.env[k] === undefined) {
        process.env[k] = v;
        loaded++;
      }
    }
    console.log(`[env] cargado ${file} (${loaded} variables nuevas)`);
  } catch (err) {
    console.warn(`[env] error leyendo ${file}: ${err.message}`);
  }
}
```

**Por qué no overridear**: permite que `RITMIQ_X=foo pnpm dev:desktop` tenga efecto incluso si el `.env.development` define `RITMIQ_X=bar`. La env externa siempre gana — útil para hot-swap en debugging sin editar el archivo.

## Casos de borde

- **Archivo no encontrado**: warn + retorno silencioso. La app arranca con `process.env` tal cual.
- **Comentarios con `#` después del valor**: no se interpretan; quedan como parte del valor.
- **Valores con `=` interno**: solo el primer `=` separa key/value, el resto va al valor. Útil para tokens base64 o URLs con query string.
- **No interpola `${OTHER}`**: si necesitás expansión, agregá `dotenv-expand` (no hoy).

## Dependencias entrantes
- [[index|main/index.js]] llama `loadEnv()` antes de cualquier otro import dependiente de `process.env`.

## Dependencias salientes
- `node:fs`, `node:path`, `node:url`.
- `electron.app.isPackaged`.

## Side-effects
- Muta `process.env`.
- Logs informativos por consola.

## Errores manejados
- Archivo no encontrado → `console.warn`, no falla.
- Error de lectura → `console.warn` con `err.message`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar el orden de `findEnvFile` candidates | En empaquetado puede no encontrar `.env.production` y arrancar sin Supabase configurado. |
| Invertir la regla de no-override | Variables externas dejan de funcionar como overrides → hot-swap roto. |
| Cambiar el parser a `dotenv` real | Habría que añadir dependencia + verificar comportamiento con comillas escapadas. |

## Notas / Changelog
- 2026-05-22: nivel simple.
