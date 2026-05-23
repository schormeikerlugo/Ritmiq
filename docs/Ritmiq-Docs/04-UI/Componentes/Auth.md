---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Auth/AuthScreen.jsx
tags: [componente, auth, login, registro, username]
---

# `AuthScreen`

> Pantalla de login / registro. Validación live de username (disponibilidad en Supabase con debounce 400ms). Maneja `signIn` y `signUp` del [[auth]] store.

## Ubicación
`packages/ui/src/components/Auth/AuthScreen.jsx:1` (392 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[auth]] store | `signIn`, `signUp`, `error`, `clearError` |
| [[supabase|ui/lib/supabase]] | Check de disponibilidad de username en `profiles` |

## Modos

- `'signin'`: email + password.
- `'signup'`: email + password + username (con validación live) + displayName (opcional).

## Validación live de username

```
regex: /^[a-z0-9_]+$/   (solo lowercase, números, guión bajo)
longitud: 3–24 chars
debounce: 400ms → SELECT FROM profiles WHERE username = ?
estados: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
```

El check consulta Supabase directamente (no el store) — la tabla `profiles` es pública para este tipo de búsqueda.

## `signUp` con metadata

Si el usuario elige username al registrarse, se pasa en `options.data` para que el trigger de Supabase lo use al crear el perfil en la tabla `profiles`. Ver [[auth#signUp]].

## Notas / Changelog
- 2026-05-22: nivel medio.
