---
tipo: modulo
capa: servidor
plataforma: servidor
estado: estable
ultima-revision: 2026-07-17
archivo: packages/server-core/src/auth-jwt.js
tags: [servidor, seguridad, jwt, supabase, es256, jwks]
---

# Autenticación y JWT (Fase 4)

> Verificación de la identidad de Supabase en el servidor, para que el
> `supabase_user_id` de un cliente sea **confiable** (extraído del `sub` de un
> token firmado), no autodeclarado. Es la base del modelo de administración por
> cuenta ([[Administracion-Dispositivos]]).

## Problema que resuelve

Antes, el `supabase_user_id` era un string que el cliente enviaba en `/pair`.
Sin verificar, cualquiera podía suplantar a otra cuenta. Con verificación de
JWT, el `user_id` sale del token firmado por Supabase → **elimina la suplantación**.

## `auth-jwt.js` — `createJwtVerifier`

Archivo: `packages/server-core/src/auth-jwt.js`. Sin dependencias externas
(usa `node:crypto`).

```js
const verifier = createJwtVerifier({
  supabaseUrl,        // deriva el JWKS: ${supabaseUrl}/auth/v1/.well-known/jwks.json
  hs256Secret,        // opcional: proyectos con clave simétrica legacy
});
const res = await verifier.verify(token);  // { userId, email, payload } | null
```

- **ES256 (recomendado)**: verifica la firma contra la **clave pública** del
  proyecto publicada en el JWKS. El servidor nunca tiene un secreto de firma →
  no puede emitir tokens. El proyecto de Ritmiq firma con ES256 (clave asimétrica
  P-256 in-use; la HS256 legacy está `previously_used`).
- **HS256 (fallback)**: valida HMAC con `RITMIQ_SUPABASE_JWT_SECRET`.
- Convierte la firma JOSE (r‖s) a DER para `crypto.verify`.
- Valida `exp`/`nbf`, `aud` (`authenticated`) e `iss`. Cachea el JWKS (TTL 1h,
  recarga si el `kid` es desconocido → rotación de claves).

## Niveles de autorización (`lan-server.js`)

| Función | Acepta | Devuelve |
|---|---|---|
| `isOwner` | access-token del dueño | boolean |
| `authorizeDeviceOrOwner` | access-token / device_token | `{owner:true}` \| `DeviceRow` |
| `authorizeAdmin` | access-token / device_token / **JWT Supabase** | `{owner:true}` \| `{userId, deviceId?}` |

- **owner** (access-token) → gestiona todo.
- **device_token** → su propio device (identidad = `supabase_user_id` del device).
- **JWT Supabase** → una cuenta (sub-admin sin device concreto aún).

## Pareo con login obligatorio

- `/pair` extrae el Bearer, lo verifica y usa el `user_id` del token
  (ignora el `supabase_user_id` del body → **anti-spoof**).
- `RITMIQ_REQUIRE_AUTH_FOR_PAIR` (default ON cuando hay verificación): sin JWT
  válido → **401 "login required to pair"**.
- El allowlist (`RITMIQ_ALLOWED_USERS`) se evalúa contra el `user_id` verificado.

## Nota de arquitectura

Exigir la app desktop para parear **no es** un control de seguridad (un atacante
usaría `curl`). La seguridad real es **JWT verificado + aprobación del dueño**.
El desktop es la vía cómoda para aprobar y aportar cookies.

## Tests

`packages/server-core/src/auth-jwt.test.js` — ES256 (JWKS real generado en test),
HS256, token expirado, audiencia incorrecta, token manipulado (payload alterado
→ null), malformado.

## Ver también

- [[Administracion-Dispositivos]] — cómo se usa `authorizeAdmin`.
- [[server-core]], [[lan-server]].
