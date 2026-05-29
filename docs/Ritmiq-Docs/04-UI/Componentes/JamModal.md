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

## Estados internos
- `view`: `'menu' | 'create' | 'join' | 'guest'` — sincronizado con `mode` del store via `useEffect`.
- `code`: input del código (join).
- `busy`: loading durante create/join/leave.
- `error`: mensaje de error inline.

## Render principal por vista
- **menu**: botones "Iniciar jam" / "Unirse a jam".
- **join**: `TextField` de 6 chars (auto-uppercase) + "Unirse".
- **create**: muestra el código (copiable) + lista de participantes con badge de Host.
- **guest**: info de la sesión + participantes + "Salir".

## Dependencias salientes
- [[jam|store jam]] (`createSession`, `joinSession`, `leaveSession`).
- [[Modal]], `Button`, `TextField`, [[Icon]], [[toast]], [[share]] (`copyToClipboard`).

## Casos de borde y gotchas
- **No se cierra solo**: si hay sesión activa, el modal no se auto-cierra; el user sale explícitamente.
- **Validación de código**: `/^[A-Z0-9]{6}$/` antes de llamar a `joinSession`.

> 🐛 **Bug conocido (a corregir)**: las líneas `:167` y `:201` usan el escape literal `\u2026`
> en JSX en vez del carácter `…`, por lo que se renderiza el texto `\u2026` en pantalla.
> Corregir al tocar este archivo (ver [[Jam-Mode]] y Bloque 3.3 del plan de mejoras).

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Quitar el `useEffect` que sincroniza `view` con `mode` | Al reabrir con sesión activa, muestra el menú en vez del estado correcto. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8.2). Anotado bug de `\u2026`.
