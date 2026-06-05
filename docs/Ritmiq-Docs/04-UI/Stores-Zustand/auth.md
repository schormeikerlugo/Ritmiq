---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/auth.js
tags: [store, auth, sesion, supabase]
---

# `stores/auth.js`

> Store de sesión de usuario. Gestiona login, registro, logout, y la suscripción `onAuthStateChange` de Supabase.

## Ubicación
`packages/ui/src/stores/auth.js:1` (89 líneas)

## Estado

```js
{
  user: { id: string, email: string|null } | null,
  loading: boolean,   // true durante init() inicial
  error: string | null,
}
```

## Acciones

| Acción | Descripción |
|---|---|
| `init()` | Carga sesión desde caché, la valida contra el servidor, suscribe a `onAuthStateChange`. |
| `signIn(email, password)` | Login con email/password. Throw si error. |
| `signUp(email, password, meta?)` | Registro. `meta.username` y `meta.displayName` se guardan en `user_metadata` para que `loadProfile()` los use al crear el perfil. |
| `signOut()` | Cierra sesión. |
| `clearError()` | Limpia `error`. |

## Anatomía del código (snippets clave)

### 1. Validación de sesión cacheada contra el servidor
`packages/ui/src/stores/auth.js:21-37`

```js
const { data: sess } = await supabase.auth.getSession();
const cached = sess.session?.user;

// Si hay sesión cacheada, la validamos contra el servidor.
// getUser() hace una petición que falla si el usuario ya no existe
// (por ejemplo tras un `supabase db reset` que limpia auth.users).
if (cached) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    await supabase.auth.signOut();
    set({ user: null, loading: false });
  } else {
    set({ user: { id: data.user.id, email: data.user.email ?? null }, loading: false });
  }
}
```

**Por qué validar con `getUser()` y no confiar en la caché**: `getSession()` lee del `localStorage` sin validar con el servidor. En desarrollo, tras `supabase db reset` el usuario desaparece de `auth.users` pero el token sigue en localStorage. Sin validación, la app mostraría la UI de usuario autenticado con un token inválido que fallaría en todos los endpoints.

### 2. `signUp` con metadata para perfil
`packages/ui/src/stores/auth.js:68-81`

```js
async signUp(email, password, meta = {}) {
  const data = {};
  if (meta.username)    data.username     = meta.username.trim().toLowerCase();
  if (meta.displayName) data.display_name = meta.displayName.trim();
  if (Object.keys(data).length > 0) options.data = data;
  const { error } = await supabase.auth.signUp({ email, password, options });
}
```

**Por qué guardar en `user_metadata`**: el trigger de Supabase que crea el perfil (`profiles`) tiene acceso a `user_metadata` del nuevo usuario. Si el usuario eligió username al registrarse, el perfil se crea con ese username; si no, se usa el fallback `user_<8chars>`. Ver [[social#loadProfile]].

## Casos de borde

- **`onAuthStateChange` registrado en cada `init()`**: si `init()` se llama múltiples veces (re-mounts), hay múltiples listeners. En la práctica `init()` solo se llama una vez desde `App.jsx`, pero si esto cambia, hay que desregistrar el listener previo.
- **`signOut()` no resetea otros stores**: el consumer (`App.jsx`) debe llamar `reset()` en los demás stores tras el logout. Ver [[library#reset]], [[playlists#reset]], [[social#reset]], etc.
- **Error de FK en `signUp`**: si el email ya existe, Supabase devuelve error → se setea en `error` y el componente lo muestra.

## Dependencias entrantes
- [[App|ui/App.jsx]] → `init()` al montar.
- [[Auth]] componente → `signIn`, `signUp`, `signOut`, `clearError`.
- [[Onboarding]] componente → `signUp`.

## Dependencias salientes
- [[supabase|ui/lib/supabase]] (cliente singleton).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `getUser()` y solo usar `getSession()` caché | Tras `db reset`, la app se bloquea mostrando UI de usuario logueado con token inválido. |
| `signOut()` que también resetea todos los stores | Acoplamiento demasiado alto; `auth.js` no debería conocer los demás stores. |
| `signUp` sin guardar `user_metadata` | Usuario creado con username random `user_<8chars>` aunque haya elegido uno al registrarse. |

## Notas / Changelog
- 2026-05-22: nivel medio.
- 2026-05-31 (**fix offline crítico**): `init()` ya no hace `signOut()` cuando `getUser()`
  falla por **error de red**. Antes, reabrir la PWA sin internet → `getUser()` error →
  signOut → librería vacía → las descargas "desaparecían" (volvían online). Ahora: si
  `!navigator.onLine` o el error no es de auth (helper `isAuthError`: 401/403/422, "user not
  found", "jwt" = real; "Failed to fetch", "Load failed" iOS, AbortError = transitorio) se
  **mantiene la sesión cacheada** (`persistSession`). Solo se cierra sesión con red + error
  de auth real. Ver [[Decisiones-Tecnicas-ADR|ADR-022]].
