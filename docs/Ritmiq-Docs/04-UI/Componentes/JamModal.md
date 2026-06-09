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

> Modal para crear o unirse a un Jam. Cinco vistas internas: `intro` (mini-wizard educativo), `menu`, `create` (hosting), `join`, `guest`. Refleja el [[jam|store jam]].

## Ubicación
`packages/ui/src/components/Jam/JamModal.jsx`

## Props
| Prop | Tipo | Descripción |
|---|---|---|
| `onClose` | `() => void` | Cierra el modal (también se llama al salir de la jam). |
| `initialCode` | `string` | (Bloque 3.3) Código pre-rellenado desde el deep-link `/jam/<code>`; abre directo en la vista `join`. |

## Estados internos
- `view`: `'intro' | 'menu' | 'create' | 'join' | 'guest'` — sincronizado con `mode` del store via `useEffect`.
- `code`: input del código (join).
- `busy`: loading durante create/join/leave.
- `error`: mensaje de error inline.
- `introStep`: paso actual (0-2) del mini-wizard `intro`.

## Mini-wizard `intro` (educativo)
Vista de 3 pasos que explica el modelo del Jam (escucha sincronizada / host con control /
cada quien con su conexión + drift). Patrón visual calcado del [[Onboarding]] pero **dentro**
del `Modal` (no backdrop propio): círculo de icono con gradiente (`data-accent` morado→cian→rosa
en pasos 2-3), halo latiendo vía pseudo-elemento `::after` (solo opacity+scale, ver
[[Decisiones-Tecnicas-ADR|ADR-020]]), dots de progreso, botón "Saltar" y CTA "Continuar"/"Entendido".

- **Gate**: `localStorage` `ritmiq.jam-intro-seen` (por dispositivo, igual que Onboarding).
  Se marca al terminar **o** al saltar; no se vuelve a mostrar automáticamente.
- **Disparo**: solo si `mode === 'idle'`, no visto y **sin** `initialCode`. Un deep-link
  `/jam/<code>` salta la intro (el invitado va directo a `join`).
- **Re-ver**: link "¿Cómo funciona una jam?" en la vista `menu` → `setView('intro')`.
- Iconos: `Radio` / `Crown` / `Wifi` (todos ya en [[Icon]]).

## Render principal por vista
- **menu**: botones "Iniciar jam" / "Unirse a jam" + link "¿Cómo funciona una jam?".
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
| Quitar `isolation: isolate` de `.introIconCircle` | El halo `::after` (z-index:-1) se va detrás del modal y el círculo del icono se ve plano (sin gradiente). |
| Borrar el `localStorage` `ritmiq.jam-intro-seen` | La intro vuelve a aparecer la próxima vez que se abre el modal (comportamiento esperado para re-onboarding). |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8.2).
- 2026-05-29: badge por `role` + "Pasar control" (Bloque 3.2); fix `\u2026`.
- 2026-05-29: `initialCode` deep-link + "Compartir invitación" Web Share (Bloque 3.3).
- 2026-05-29: **rediseño UX**. Tildes corregidas en todos los textos ("música",
  "reproducción", "código", "Estás"). Botones del menú ahora usan `iconLeft` + `fullWidth` +
  `size="lg"` (antes el `<Icon>` como children rompía el botón en 2 líneas). Hero icon
  (`Radio`) en el menú. Código de sesión con hint "Copiar" (icono `Copy`). Lista de
  participantes con avatares (`Crown` host / `User` guest), badge "Host" pill, contador en
  el título, hover por fila. Iconos nuevos registrados en [[Icon]]: `Radio`, `Crown`, `Copy`,
  `LogIn`.
- 2026-05-31: **mini-wizard `intro`** de 3 pasos (escucha sincronizada / host con control /
  cada quien con su conexión). Aparece la 1ª vez (gate `ritmiq.jam-intro-seen`, por
  dispositivo), salta en deep-link, re-verible desde "¿Cómo funciona una jam?" en el menú.
  Estilo calcado de [[Onboarding]] dentro del `Modal`; halo del icono con `::after`
  (opacity+scale, [[Decisiones-Tecnicas-ADR|ADR-020]]) y `isolation:isolate` en el círculo
  para que el halo quede sobre el card. Iconos `Radio`/`Crown`/`Wifi` (ya en [[Icon]]).
  Verificado con Playwright en 1300px y 390px.
- 2026-06-02 (**arranque coordinado**, Bloque 3.7): indicador por participante (spinner `Loader`
  / check `Check`) según `readyByUser`. Barra de espera del host "Esperando a N…" + botón
  "Reproducir igualmente" (`forceStart`) cuando hay `waitingFor`. Estilos `.partLoading`/
  `.partReady`/`.waitBar`/`.waitText`/`.waitForce` (spin solo transform, respeta
  prefers-reduced-motion). Ver [[Decisiones-Tecnicas-ADR|ADR-026]].
- 2026-06-03 (**modo Altavoz**, Bloque 3.8): vista `kind` (selector "Sincronizado"/"Altavoz" con
  tarjetas) tras "Iniciar jam" → `createSession(kind)`. Badge de tipo en la vista `create`. En la
  vista `guest`, si `kind==='speaker'`, se muestra un **control remoto** (portada+título de lo que
  suena en el altavoz + play/pausa/anterior/siguiente → `requestControl`). Iconos `Volume2`.
  Estilos `.kindView/.kindCard/.kindBadge/.remote*`. Ver [[Decisiones-Tecnicas-ADR|ADR-028]].
