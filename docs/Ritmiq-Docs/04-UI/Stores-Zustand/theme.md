---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/theme.js
tags: [store, tema, dark-mode, persistencia]
---

# `stores/theme.js`

> Store del tema de la app — `dark` / `light` / `auto`. Persiste en `localStorage` y aplica el atributo `data-theme` al `<html>` que el CSS reacciona.

## Ubicación
`packages/ui/src/stores/theme.js:1` (57 líneas)

## Estado

```js
{
  theme: 'dark' | 'light' | 'auto'  // default: 'dark'
}
```

## Acciones

| Acción | Descripción |
|---|---|
| `setTheme(theme)` | Valida contra `['dark','light','auto']`, persiste en localStorage y aplica al DOM |

## Export adicional

```js
function initTheme(): void
```

Llama a `applyToDom(current)` en el arranque de la app **antes del primer render** para evitar el flash de tema incorrecto (FOUC). Ver [[App]].

## Anatomía del código (snippet clave)

### Por qué default es `'dark'` y no `'auto'`
`packages/ui/src/stores/theme.js:9-10`

```js
// Si no hay valor guardado, arranca en 'dark' (no en 'auto') porque la app fue diseñada
// en oscuro y los usuarios existentes esperan ese look.
```

**Decisión explícita**: `'auto'` podría sorprender a usuarios con sistema en tema claro que esperan ver Ritmiq oscuro. `'dark'` es el look canónico.

## Mecanismo de aplicación

```js
document.documentElement.dataset.theme = theme;
// equivale a: <html data-theme="dark">
```

`tokens.css` tiene reglas `[data-theme='light'] { --bg: ... }` etc. El CSS cambia instantáneo sin re-render de React.

## Persistencia

| Clave localStorage | Valores válidos |
|---|---|
| `ritmiq.theme` | `'dark'` \| `'light'` \| `'auto'` |

Lectura defensiva: si el valor guardado es inválido o la clave no existe → `'dark'`. Si `localStorage` no está disponible (SSR) → `'dark'`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `initTheme()` del bootstrap | Flash de tema incorrecto al cargar (FOUC de ~100ms). |
| Cambiar la clave localStorage | Preferencia del usuario se pierde entre versiones. |
| Cambiar `VALID` sin actualizar `setTheme` | Valor inválido en localStorage queda sin aplicar silenciosamente. |

## Notas / Changelog
- 2026-05-22: nivel simple.
