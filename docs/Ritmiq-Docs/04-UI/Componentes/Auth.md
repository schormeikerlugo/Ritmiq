---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-26
archivo: packages/ui/src/components/Auth/AuthScreen.jsx
tags: [componente, auth, login, registro, username, forgot-password]
---

# `AuthScreen`

> Shell del flujo de autenticación. Layout split (hero waveform animado a la izquierda + card de formulario a la derecha en desktop, stack en mobile). Orquesta tres vistas: `SignInView`, `SignUpView`, `ForgotPasswordView`. El flujo de recovery se renderiza desde `App.jsx` con `ResetPasswordView` cuando llega el link del email.

## Estructura de archivos

```
packages/ui/src/components/Auth/
├── AuthScreen.jsx              (shell + mode state)
├── AuthScreen.module.css       (layout split / stacked)
├── AuthHero.jsx                (waveform SVG animado)
├── AuthHero.module.css
├── AuthCard.jsx                (contenedor + transición animada de views + footer legal)
├── AuthCard.module.css
└── views/
    ├── SignInView.jsx          (email + password + forgot link)
    ├── SignInView.module.css
    ├── SignUpView.jsx          (displayName opcional + email + @username obligatorio + password + strength)
    ├── SignUpView.module.css
    ├── ForgotPasswordView.jsx  (email → resetPasswordForEmail)
    ├── ForgotPasswordView.module.css
    ├── ResetPasswordView.jsx   (nueva password + confirm; renderizada por App.jsx)
    └── ResetPasswordView.module.css
```

## Modos del shell

| mode | Vista | Descripción |
|---|---|---|
| `signin` | `SignInView` | Email + Password. Link a forgot password. Link a signup. |
| `signup` | `SignUpView` | DisplayName (opcional) + Email + @Username (obligatorio con auto-sugerencia del email en blur) + Password con strength meter. |
| `forgot` | `ForgotPasswordView` | Email único; al enviar muestra confirmación "Revisa tu correo". |

`ResetPasswordView` es una pantalla separada renderizada por `App.jsx` cuando detecta `#reset-password` en la URL o cuando Supabase dispara `onAuthStateChange` con `event === 'PASSWORD_RECOVERY'`.

## Primitives nuevos (reutilizables)

Creados en `packages/ui/src/components/primitives/`:

- `<Button />` — variants `primary | ghost | subtle | danger`, sizes `sm | md | lg`, prop `loading` con spinner integrado.
- `<TextField />` — label + input + iconos prefix/suffix + hint/error/success + variants visuales.
- `<PasswordField />` — extiende TextField con reveal toggle (Eye/EyeOff), Caps Lock warning, y `showStrength` opcional.
- `<PasswordStrengthMeter />` — barra de 4 segmentos con label y sugerencias.
- `<FormError />`, `<FormSuccess />` — banners de feedback global.

Importación: `import { Button, TextField, PasswordField, ... } from '../../primitives/index.js';`

## Utilities

`packages/ui/src/lib/`:

- `errorMessages.js` — `translateAuthError(err, { context })` mapea errores Supabase Auth a español según contexto (`signin | signup | forgot | reset`).
- `passwordStrength.js` — `scorePassword(pwd) → { score: 0..3, label, suggestions }` y `isPasswordAcceptable(pwd)`.
- `usernameSuggest.js` — `suggestUsernameFromEmail('pedro.lopez@gmail.com') → 'pedro_lopez'`.

## Stores consumidos

| Store | Uso |
|---|---|
| [[auth]] store | `signIn`, `signUp`, `resetPassword`, `updatePassword`, `clearError` |
| [[supabase|ui/lib/supabase]] | Check de disponibilidad de username en `profiles` (debounce 350ms) |

## Validación live de username

```
regex: /^[a-z0-9_]+$/
longitud: 3–24 chars
debounce: 350ms → SELECT FROM profiles WHERE username = ?
estados: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error'
```

Al hacer blur del email, si el usuario aún no editó el username, se auto-rellena con la parte sanitizada del email (`pedro.lopez@gmail.com` → `pedro_lopez`).

## UX detalles

- **Auto-focus** del primer campo al entrar a cada vista.
- **Animación shake** del form al fallar submit (`prefers-reduced-motion` desactiva).
- **Cross-fade slide** entre vistas (220ms) en `AuthCard`.
- **Caps Lock warning** dentro de PasswordField (live).
- **Reveal toggle** del password (Eye/EyeOff).
- **Password strength meter** con sugerencias en signup y reset.
- **Mobile keyboard handling**: `padding-bottom: env(keyboard-inset-height, 0)` para que el form no quede tapado por el teclado iOS.
- **Footer legal**: links Términos / Privacidad placeholder.
- **A11y**: `aria-invalid`, `aria-describedby`, `aria-live="polite"` en hints, focus visible reforzado.

## Recovery flow (link de email)

1. Usuario pulsa "¿Olvidaste tu contraseña?" → `ForgotPasswordView`.
2. Envía email → `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/#reset-password' })`.
3. Usuario abre el correo y pulsa el link.
4. Supabase valida el token y crea sesión temporal de recovery.
5. `App.jsx` detecta `#reset-password` en URL o evento `PASSWORD_RECOVERY` y renderiza `ResetPasswordView` en lugar del shell normal.
6. Usuario escribe nueva contraseña + confirm → `updatePassword(newPassword)` → success → `signOut` + redirect a `/`.

## Hero waveform (`AuthHero`)

SVG con 56 barras (32 en mobile) cada una con animación CSS `scaleY` independiente. Gradient lineal de marca (morado → cian → rosa → verde). Glow de fondo animado con `radial-gradient`. Tagline grande con accent gradient. Reduced-motion lo deja estático.

## Notas / Changelog

- 2026-05-26: Refactor completo. AuthScreen split en views. Primitives nuevos. Forgot/Reset password. Errores traducidos. Password strength meter. Hero waveform animado. Username obligatorio con auto-sugerencia.
- 2026-05-22: nivel medio (versión anterior: 186 líneas, 1 archivo).
</content>
</invoke>