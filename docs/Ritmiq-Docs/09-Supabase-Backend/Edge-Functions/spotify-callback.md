---
tipo: edge-function
capa: supabase
plataforma: backend
estado: beta
ultima-revision: 2026-05-29
archivo: supabase/functions/spotify-callback/index.ts
tags: [edge-function, spotify, oauth, pkce, inert]
---

# `spotify-callback`

> Handler del OAuth PKCE de Spotify: intercambia el `code` por `access_token` + `refresh_token` y los persiste en [[spotify_tokens]]. **Estado: deployada (v1 ACTIVE) pero inert** — falta registrar la app en Spotify y setear secrets. Ver [[Activar-Spotify-OAuth]].

## Ubicación
`supabase/functions/spotify-callback/index.ts`

## Endpoint
```
POST /spotify-callback
Headers: Authorization: Bearer <user JWT>, apikey: <anon>
Body: { code: string, codeVerifier: string, redirectUri: string }
```

## Inputs
| Nombre | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `code` | `string` | sí | Authorization code de Spotify (`?code=`). |
| `codeVerifier` | `string` | sí | PKCE verifier (vino de sessionStorage del cliente). |
| `redirectUri` | `string` | sí | Debe coincidir con el registrado en Spotify. |

## Variables de entorno (Supabase secrets)
| Secret | Obligatorio | Nota |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | sí | Sin él → 500. |
| `SPOTIFY_CLIENT_SECRET` | opcional | Si está, se envía como `Authorization: Basic` → más seguro (PKCE + secret). |

## Outputs / Retorno
```json
{ "ok": true, "expiresIn": 3600 }
```

## Anatomía del código (snippets comentados)

### Secret opcional para PKCE + Basic auth
`supabase/functions/spotify-callback/index.ts:97-100`

```ts
if (clientSecret) {
  const basic = btoa(`${clientId}:${clientSecret}`);
  headers['Authorization'] = `Basic ${basic}`;
}
```

**Decisión**: PKCE puro no requiere secret, pero si está presente lo usamos. Como esta function corre server-side, el secret nunca toca el cliente → seguridad extra sin coste. Ver [[Decisiones-Tecnicas-ADR|ADR]] / [[Activar-Spotify-OAuth]].

### Margen de 30s en expires_at
`supabase/functions/spotify-callback/index.ts:126-127`

```ts
const expiresAt = new Date(Date.now() + (tokenData.expires_in - 30) * 1000);
// -30s de margen para evitar usar el token justo cuando vence.
```

**Por qué**: evita la condición de carrera de usar un token a punto de expirar.

## Dependencias salientes
- `accounts.spotify.com/api/token` (intercambio).
- [[spotify_tokens]] (upsert via service role).

## Dependencias entrantes
- [[spotify-oauth]] (`exchangeCodeForToken`).

## Side-effects
- Red: POST a Spotify token endpoint.
- DB: upsert en `spotify_tokens` (service role).

## Errores manejados
- `401` sin Authorization / user no resuelto.
- `400` faltan `code`/`codeVerifier`/`redirectUri`.
- `500` `SPOTIFY_CLIENT_ID` no configurado / fallo de escritura.
- `502` red o error de Spotify (`spotify <status>: <body>`).

## Casos de borde y gotchas
- **redirectUri exacto**: Spotify rechaza si no coincide carácter por carácter con el registrado en el dashboard.
- **Sin refresh aquí**: esta function solo hace el intercambio inicial. El refresh del token expirado debe hacerlo la futura edge `spotify-recs` (ver [[Activar-Spotify-OAuth]] paso 6).

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Cambiar el shape del body esperado | `exchangeCodeForToken` recibe 400 → "No se pudo conectar". |
| Quitar el `onConflict: 'user_id'` | Reconectar genera filas duplicadas → PK violation. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6.3). Estado beta/inert.
