---
tipo: modulo
capa: api
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/api/src/supabase.js
tags: [api, supabase, cliente]
---

# `api/supabase.js`

> Factory que crea un cliente Supabase con configuración estándar para Ritmiq. Envuelve `createClient` de `@supabase/supabase-js` con opciones fijadas.

## Ubicación
`packages/api/src/supabase.js:1` (15 líneas)

## Firma

```js
function createSupabase(url: string, anonKey: string): SupabaseClient
```

## Anatomía del código (completo)

`packages/api/src/supabase.js:1-15`

```js
import { createClient } from '@supabase/supabase-js';

export function createSupabase(url, anonKey) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,    // guarda session en localStorage
      autoRefreshToken: true,  // renueva access_token antes de que expire
      detectSessionInUrl: false, // deshabilita OAuth callback en URL
    },
  });
}
```

**Por qué `detectSessionInUrl: false`**: Ritmiq no usa flujos OAuth con redirect. Si no lo deshabilitamos, Supabase intenta parsear el fragment `#access_token=...` de la URL en cada carga — confunde el router de Vite en desarrollo y no hace nada útil.

**Por qué `persistSession: true`**: el usuario no debería tener que loguearse cada vez que abre la app. La sesión se guarda en `localStorage` con la clave `supabase.auth.token`.

**Por qué `autoRefreshToken: true`**: los access tokens de Supabase expiran en 1 hora. Sin auto-refresh, tras una hora la app empieza a recibir 401 en todas las llamadas. Con auto-refresh, Supabase renueva silenciosamente usando el refresh token.

## Dónde se instancia

| Consumidor | Instancia | Variables |
|---|---|---|
| Desktop renderer | `packages/ui/src/lib/supabase.js` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| PWA | `packages/ui/src/lib/supabase.js` | Ídem |

`createSupabase` se llama una sola vez al cargar; la instancia se exporta como singleton.

## Casos de borde y gotchas

- **`url` o `anonKey` vacíos**: `createClient` acepta strings vacíos sin error. La primera llamada a la API fallará con `fetch` a URL inválida. No hay validación aquí — responsabilidad del caller asegurarse de que las env vars estén cargadas.
- **Multiple instances**: si por error se llama `createSupabase` dos veces, hay dos clientes con sesiones independientes. En teoría Supabase JS v2 maneja eso, pero puede generar conflictos de token refresh. Evitar.
- **`localStorage` no disponible**: en SSR o en contexts sin `localStorage` (Web Workers), `persistSession: true` falla silenciosamente en supabase-js v2. No aplica a Ritmiq hoy.

## Dependencias entrantes
- `packages/ui/src/lib/supabase.js` (singleton del renderer/PWA).

## Dependencias salientes
- `@supabase/supabase-js`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `detectSessionInUrl: true` | En dev, Vite hash-router confundido con fragments de OAuth. En prod, no afecta pero es ruido. |
| `autoRefreshToken: false` | Tras 1h de sesión activa, todas las llamadas a Supabase devuelven 401. |
| `persistSession: false` | Usuario se cierra y se reabre la app → debe loguearse de nuevo cada vez. |

## Notas / Changelog
- 2026-05-22: nivel simple.
