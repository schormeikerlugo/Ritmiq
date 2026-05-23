---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/bottom-sheet.js
tags: [store, bottom-sheet, modal, ux]
---

# `stores/bottom-sheet.js`

> Store global para BottomSheets apilables. Un único punto de control para todos los sheets de la app. Los sheets se renderizan desde `<BottomSheetHost />` en `App.jsx`, no desde cada consumidor.

## Ubicación
`packages/ui/src/stores/bottom-sheet.js:1` (100 líneas)

## Por qué un store global y no portal por componente

Centralizar en el store:
- Evita duplicación de lógica de animación/backdrop.
- Permite stacking (un sheet encima de otro).
- Simplifica el flujo de `onClose` (un solo host, no N portales).
- Permite `closeAll()` en navegación global sin coupling.

## Tipo `BottomSheetEntry`

```js
{
  id: number,                          // auto-incremental
  title?: string,
  header?: ReactNode,                  // override del header
  content: ReactNode,                  // cuerpo del sheet
  dismissOnBackdrop?: boolean,         // default true
  onClose?: () => void,                // callback al cerrar POR interacción
}
```

## Estado

```js
{
  stack: BottomSheetEntry[]  // stack de sheets abiertos
}
```

## Acciones

| Acción | Devuelve | Descripción |
|---|---|---|
| `open(entry)` | `number` (id) | Apila el sheet. Devuelve id para `closeById`. |
| `close()` | — | Cierra el top del stack. NO llama `onClose`. |
| `closeById(id)` | — | Cierra uno específico. NO llama `onClose`. |
| `closeAll()` | — | Limpia el stack. Para navegación/reset. |
| `update(id, patch)` | — | Actualiza props de un sheet sin animación de cierre/apertura. |

## Anatomía del código (snippet clave)

### Contrato crítico de `onClose`
`packages/ui/src/stores/bottom-sheet.js:7-14`

```js
// Contrato sobre `onClose`:
//   - El callback `entry.onClose` se invoca SOLO cuando el sheet pide
//     cerrarse desde su propia interaccion (click en backdrop, ESC, swipe).
//     Lo dispara <BottomSheetHost />, NO el store.
//   - Las acciones `close`, `closeById`, `closeAll` del store NO llaman a
//     `onClose`. Asi, cerrar un sheet "externamente" (cleanup de un
//     useEffect, navegacion) no provoca doble dispatch hacia el consumidor.
```

**Por qué este contrato**: si `close()` del store llamara a `onClose`, y el consumer en su `onClose` también llama `close()`, tenemos loop infinito. Además, cerrar externamente (navegación) no debe disparar efectos del consumer.

### `update`: refrescar contenido sin animar

```js
update(id, patch) { /* reemplaza props del entry */ }
```

Útil cuando el componente que abrió el sheet re-renderiza con nuevo state y quiere actualizar el contenido del sheet sin que parezca que se cerró y reabrió.

## Patrón de uso correcto para forms

```jsx
// ✅ Correcto: componente propio con state aislado
function BodyForm({ onClose }) {
  const [val, setVal] = useState('');
  return <input value={val} onChange={(e) => setVal(e.target.value)} />;
}
const id = open({ title: 'Form', content: <BodyForm onClose={handleClose} /> });
```

Si el estado del form vive en el componente padre y se pasa como prop al sheet content, cada cambio del padre re-renderiza el content y el input pierde el foco.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `close()` que llama `onClose` | Loop infinito si el consumer también llama `close()` en su `onClose`. |
| Renderizar sheets desde portales en cada componente | Duplicación de overlays; stacking imposible; z-index wars. |
| `open()` sin retornar id | Imposible cerrar un sheet específico en stacks de múltiples sheets. |

## Notas / Changelog
- 2026-05-22: nivel simple.
