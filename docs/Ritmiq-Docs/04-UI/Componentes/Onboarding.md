---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Onboarding/Onboarding.jsx
tags: [componente, onboarding, modal, pasos, localstorage]
---

# `Onboarding`

> Modal de 3 pasos que aparece al primer login en cada dispositivo. Persiste el completado en localStorage por dispositivo (no por cuenta).

## Ubicación
`packages/ui/src/components/Onboarding/Onboarding.jsx:1` (331 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[auth]] store | `user` (solo se monta si hay sesión) |

## Condición de render

```js
// Solo si hay usuario Y el flag no está en localStorage
if (!user || hasCompleted) return null;
```

## Versioning del key

```js
const LS_KEY = 'ritmiq.onboarding-completed.v2';
const LS_KEY_V1 = 'ritmiq.onboarding-completed';  // limpieza del anterior
```

**Por qué versionar**: cuando se añaden nuevas secciones al onboarding (social, push notifications), los usuarios que vieron el flujo anterior deben ver el nuevo. Bumear la versión hace que `hasCompleted` sea `false` para ellos.

## Por dispositivo, no por cuenta

Un usuario que entra desde 2 dispositivos ve el onboarding en cada uno. Intencional: familiariza con las particularidades de cada plataforma (PWA mobile tiene swipe, desktop tiene shortcuts).

## Pasos

Definidos en el array `STEPS[]` — cada step tiene `title`, `description`, `icon` y `illustration`. El último paso llama a `pushPermission` (si aplica) y marca el localStorage.

## Notas / Changelog
- 2026-05-22: nivel medio.
