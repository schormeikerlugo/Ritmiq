---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/EditProfileDialog/EditProfileDialog.jsx
tags: [componente, perfil, edit, avatar, social]
---

# `EditProfileDialog`

> Dialog de edición del perfil propio. Permite cambiar display name, @username, bio, y subir/borrar avatar (Storage bucket `avatars`).

## Ubicación
`packages/ui/src/components/EditProfileDialog/EditProfileDialog.jsx:1` (522 líneas)

## Props

```js
{ onClose: () => void }
```

## Stores consumidos

| Store | Uso |
|---|---|
| [[social]] store | `profile`, `updateProfile`, `uploadAvatar`, `removeAvatar` |

## Campos editables

| Campo | Validación |
|---|---|
| display name | Max 50 chars |
| @username | `^[a-z0-9_]+$`, 3–24 chars, disponibilidad en tiempo real |
| bio | Max 200 chars |
| avatar | JPEG/PNG/WebP, max 2MB |

## Subida de avatar

1. `input[type=file]` → preview local.
2. `uploadAvatar(file)` → valida 2MB + formato → Storage upload → update `avatar_url`.
3. Cache buster `?v=timestamp` en la URL para que los amigos vean el nuevo avatar inmediatamente.

## Notas / Changelog
- 2026-05-22: nivel medio.
