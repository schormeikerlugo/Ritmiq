---
tipo: modulo
capa: ui
plataforma: ambas
estado: beta
ultima-revision: 2026-05-29
archivo: packages/ui/src/lib/spotify-oauth.js
tags: [helper, spotify, oauth, pkce, inert]
---

# `spotify-oauth`

> Cliente del flow OAuth PKCE de Spotify. **Estado: infraestructura inert** — la UI no expone aún el botón "Conectar Spotify". Ver [[Activar-Spotify-OAuth]] para el checklist de activación.

## Ubicación
`packages/ui/src/lib/spotify-oauth.js`

## Exports
| Export | Firma | Uso |
|---|---|---|
| `startSpotifyAuth()` | `() → Promise<void>` | Inicia el flow; redirige a Spotify. No retorna (navega). |
| `exchangeCodeForToken(code, state)` | `→ {ok, expiresIn?, error?}` | Llamado en el callback; valida state + llama [[spotify-callback]]. |
| `disconnectSpotify()` | `→ Promise<boolean>` | Borra el token local (no revoca en Spotify). |
| `getSpotifyConnectionStatus()` | `→ {connected, expiresAt?, scope?}` | Estado de conexión. |

## Scopes solicitados
```js
const SCOPES = ['user-top-read', 'user-read-recently-played'].join(' ');
```

## Anatomía del código (snippets comentados)

### PKCE: verifier + challenge S256
`packages/ui/src/lib/spotify-oauth.js:64-74`

```js
const verifier = generateCodeVerifier();
const challenge = await generateCodeChallenge(verifier);
const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
// Persiste verifier + state para validar en el callback.
sessionStorage.setItem('ritmiq.spotify-pkce-verifier', verifier);
sessionStorage.setItem('ritmiq.spotify-pkce-state', state);
```

**Por qué**: PKCE evita exponer un client_secret en el cliente. El `verifier` se queda en sessionStorage; el `challenge` (su SHA-256) viaja a Spotify. El `state` previene CSRF.

### Validación de state en el callback
`packages/ui/src/lib/spotify-oauth.js:110-115`

```js
if (!storedState || storedState !== state) {
  return { ok: false, error: 'state mismatch (posible CSRF)' };
}
```

**Por qué**: si el `state` que vuelve de Spotify no coincide con el guardado, alguien pudo inyectar la redirección.

## Inputs (env)
| Variable | Obligatorio | Nota |
|---|---|---|
| `VITE_SPOTIFY_CLIENT_ID` | sí | Sin él, `startSpotifyAuth` throw. Es público (PKCE). |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | sí | Para llamar a [[spotify-callback]]. |

## Side-effects
- Storage: `sessionStorage` (`ritmiq.spotify-pkce-verifier` / `-state`).
- Red: redirige a `accounts.spotify.com/authorize`; POST a [[spotify-callback]].
- DB: `disconnectSpotify` borra de [[spotify_tokens]]; `getSpotifyConnectionStatus` lee.

## Casos de borde y gotchas
- **redirectUri derivado de `window.location.origin`**: en dev es `localhost:5173`, en prod el dominio. **Ambos deben estar registrados** en el dashboard de Spotify.
- **Inert**: sin `VITE_SPOTIFY_CLIENT_ID` ni botón de UI, nada de esto se ejecuta.
- **`disconnectSpotify` no revoca en Spotify**: solo borra el token local.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Cambiar la ruta `/auth/spotify-callback` | El redirectUri deja de coincidir con Spotify → error en el authorize. |
| Quitar la validación de state | Vulnerable a CSRF en el callback. |

## Dependencias salientes
- [[spotify-callback]] (edge), [[spotify_tokens]] (tabla), [[supabase]] (cliente).

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6.3). Estado beta/inert.
