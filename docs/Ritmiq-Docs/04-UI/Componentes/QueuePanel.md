---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/QueuePanel/QueuePanel.jsx
tags: [componente, cola, drag-drop, dnd-kit, sidebar]
---

# `QueuePanel`

> Panel lateral de cola de reproducción. **Contextual**: sin jam es la cola local (3 secciones: "Sonando ahora", "A continuación" reordenable, "Reproducidas"); con una jam activa se transforma en la **cola colaborativa del Jam** (sugerencias identificadas por avatar+nombre).

## Modo contextual (Bloque 3.4)
`QueuePanel` lee `useJamStore(s => s.mode)`:
- **`idle`** → `LocalQueueView` (comportamiento original, sin cambios).
- **`hosting` / `guest`** → `JamQueueView`: misma entrada/botón, pero muestra la cola del Jam
  desde [[jam_queue]] (vía [[jam|store jam]] `suggestions`). Secciones: "Sonando ahora"
  (`jam.state.currentTrack`), "Sugerencias" (pendientes) y "Reproducidas". Cada fila lleva un
  chip **avatar + nombre del sugeridor** (`profileLabel`: display_name > @username > id corto;
  avatar de `profilesById`, fallback a icono `User`).
- **Permisos**: el **host** ve tap-para-reproducir (`playSuggestion`) y quitar cualquiera; el
  **guest** ve la lista, su tap muestra toast "El host controla la reproducción", y solo puede
  quitar sus sugerencias no reproducidas (RLS lo valida server-side). Para **añadir** se usa
  "Sugerir a la jam" en el menú de track (ver [[PlaylistView]]).

## Ubicación
`packages/ui/src/components/QueuePanel/QueuePanel.jsx:1` (567 líneas)

## Props

```js
{ onClose: () => void }
```

## Stores consumidos

| Store | Campos |
|---|---|
| [[player]] | `queue`, `index`, `moveQueueItem`, `removeFromQueue`, `clearQueue` |

## Drag & Drop

Sensores separados por device:
- `MouseSensor(distance: 4)` → desktop, sin delay.
- `TouchSensor(delay: 220, tolerance: 6)` → mobile, distingue tap de drag.
- `KeyboardSensor` → accesibilidad.

Keys DnD: `q-{realIdx}-{t.id}` — combinan índice real + id para evitar colisión si el mismo track está dos veces en la cola.

`handleDragEnd` mapea de `dndId` (orden visual) a `realIdx` (posición en la queue) y llama `moveQueueItem(fromIdx, toIdx)`.

## Secciones

- **Sonando ahora**: `queue[index]` — sin drag, no puede borrarse desde aquí.
- **A continuación**: `queue.slice(index + 1)` — sortable.
- **Reproducidas**: `queue.slice(0, index)` — colapsado por defecto, sin drag (historial de sesión).

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Keys DnD solo por `t.id` | Si el mismo track está 2 veces en la cola → colisión de keys → DnD corrupto. |
| Sin `delay: 220` en touch | Scroll del panel inicia drag → usuario no puede scrollear la cola larga. |

## Notas / Changelog
- 2026-05-22: nivel medio.
- 2026-05-31 (**cola colaborativa**): panel contextual. Refactor a `LocalQueueView` +
  `JamQueueView` según `useJamStore.mode`. Filas del jam con chip avatar+nombre del sugeridor
  (`.suggestedBy`/`.suggesterAvatar`). Verificado con Playwright (380px). Ver [[jam_queue]],
  [[jam|store jam]] y [[Decisiones-Tecnicas-ADR|ADR-024]].
