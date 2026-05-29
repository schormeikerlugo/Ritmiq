---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-29
archivo: packages/ui/src/components/Jam/JamModal.jsx
tags: [componente, jam, modal, colaborativo]
---

# `JamModal`

> Modal para crear o unirse a un Jam. Cuatro vistas internas: `menu`, `create` (hosting), `join`, `guest`. Refleja el [[jam|store jam]].

## Ubicación
`packages/ui/src/components/Jam/JamModal.jsx`

## Props
| Prop | Tipo | Descripción |
|---|---|---|
| `onClose` | `() => void` | Cierra el modal (también se llama al salir de la jam). |
| `initialCode` | `string` | (Bloque 3.3) Código pre-rellenado desde el deep-link `/jam/<code>`; abre directo en la vista `join`. |

## Estados internos
- `view`: `'menu' | 'create' | 'join' | 'guest'` — sincronizado con `mode` del store via `useEffect`.
- `code`: input del código (join).
- `busy`: loading durante create/join/leave.
- `error`: mensaje de error inline.

## Render principal por vista
- **menu**: botones "Iniciar jam" / "Unirse a jam".
- **join**: `TextField` de 6 chars (auto-uppercase) + "Unirse".
- **create**: muestra el código (copiable) + `renderParticipants(true)` (con botón "Pasar control").
- **guest**: info de la sesión + `renderParticipants(false)` + "Salir".

## `renderParticipants(canTransfer)` (Bloque 3.2)
Helper que pinta la lista. El badge de Host usa `p.role === 'host'` (con fallback a
`session.hostId` para sesiones legacy). Si `canTransfer` y el participante es guest, muestra
botón "Pasar control" → `transferHost(user_id)`.

## Compartir invitación (Bloque 3.3)
`handleShareInvite` usa `navigator.share` (Web Share API nativa, mobile) con la URL
`buildJamLink(code)` = `<origin>/jam/<CODE>`. Fallback a `copyToClipboard` del enlace en
desktop / sin soporte. `AbortError` (usuario cancela) se ignora silenciosamente.

## Dependencias salientes
- [[jam|store jam]] (`createSession`, `joinSession`, `leaveSession`).
- [[Modal]], `Button`, `TextField`, [[Icon]], [[toast]], [[share]] (`copyToClipboard`).

## Casos de borde y gotchas
- **No se cierra solo**: si hay sesión activa, el modal no se auto-cierra; el user sale explícitamente.
- **Validación de código**: `/^[A-Z0-9]{6}$/` antes de llamar a `joinSession`.

> ✅ **Bug corregido (Bloque 3.2)**: las dos listas de participantes inline usaban el escape
> literal `\u2026` (se renderizaba el texto `\u2026`). Al unificar en `renderParticipants` se
> reemplazó por el carácter `…` real.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Quitar el `useEffect` que sincroniza `view` con `mode` | Al reabrir con sesión activa, muestra el menú en vez del estado correcto. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8.2).
- 2026-05-29: badge por `role` + "Pasar control" (Bloque 3.2); fix `\u2026`.
- 2026-05-29: `initialCode` deep-link + "Compartir invitación" Web Share (Bloque 3.3).
