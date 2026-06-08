---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/player.js
tags: [store, player, cola, shuffle, repeat, radio]
---

# `stores/player.js`

> Store Zustand de la cola de reproducción y estado del player. Fuente de verdad de qué se está reproduciendo, en qué orden, y qué controles están activos. La lógica de audio real vive en [[use-player]] hook (que conecta este store con [[player|core/Player]]).

## Ubicación
`packages/ui/src/stores/player.js:1` (230 líneas)

## Relación con otros módulos

```
usePlayerStore ←→ use-player hook ←→ core/Player ←→ AudioBackend (howler/html-audio)
```

El store mantiene `queue`, `index`, `isPlaying`, `positionSeconds`. El hook [[use-player]] lee el store, opera el `Player` core, y hace `patch()` con los cambios de estado.

## Estado

```js
{
  currentTrack: Track | null,
  queue: Track[],
  index: number,          // -1 si vacío
  isPlaying: boolean,
  positionSeconds: number,
  durationSeconds: number,
  volume: number,         // 0..1, default 0.8
  shuffle: boolean,
  repeat: 'off' | 'one' | 'all',
  error: string | null,
  radioMode: boolean,
  radioSeedArtist: string | null,
}
```

## Inventario de acciones

| Acción | Descripción |
|---|---|
| `playNow(input, startIdx?)` | Reemplaza cola completa. Acepta Track o Track[]. |
| `playNext(track)` | Inserta justo después del actual (index+1). |
| `enqueue(input)` | Añade al final. |
| `removeFromQueue(idx)` | Quita por índice. Si era el actual, salta al siguiente. |
| `clearQueue()` | Vacía cola y resetea estado. |
| `moveQueueItem(from, to)` | Reordena (drag & drop). Ajusta index. |
| `next()` | Avanza según repeat/shuffle. Returns bool. |
| `prev()` | Si > 3s: reinicia actual. Si no: retrocede. |
| `patch(p)` | Escape hatch: actualiza cualquier prop. Usado por el hook. |
| `startRadio()` | Activa radioMode con seed = currentTrack.artist. |
| `stopRadio()` | Desactiva sin tocar la cola. |
| `appendQueue(tracks)` | Añade al final sin cambiar index. Usado por el motor de radio. |
| `setCurrent(t)` | Compat: llama `playNow(t)`. |
| `togglePlay()` | Toggle `isPlaying`. |
| `setVolume(v)` | Clamp 0..1. |
| `toggleShuffle()` | Toggle. |
| `cycleRepeat()` | `off → all → one → off`. |

## Anatomía del código (snippets clave)

### 1. `moveQueueItem`: reorder preservando el currentTrack
`packages/ui/src/stores/player.js:128-146`

```js
moveQueueItem(fromIdx, toIdx) {
  const { queue, index } = get();
  if (fromIdx === toIdx) return;
  const next = queue.slice();
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);

  let nextIndex = index;
  if (index === fromIdx) {
    nextIndex = toIdx;                        // movimos el track actual
  } else if (fromIdx < index && toIdx >= index) {
    nextIndex = index - 1;                    // algo de arriba bajó hasta nosotros
  } else if (fromIdx > index && toIdx <= index) {
    nextIndex = index + 1;                    // algo de abajo subió hasta nosotros
  }
  set({ queue: next, index: nextIndex });
},
```

**Los 3 casos de ajuste de index**: si el track que movés es el actual → el index sigue al track. Si un track de arriba del actual se mueve hacia abajo pasando por el actual → el actual "sube" (index--). Si un track de abajo sube pasando por el actual → el actual "baja" (index++). Sin esto, `currentTrack` y `queue[index]` quedarían desincronizados.

### 2. `next()`: shuffle distinto del actual
`packages/ui/src/stores/player.js:148-182`

```js
if (shuffle) {
  if (queue.length === 1) nextIdx = 0;
  else {
    do { nextIdx = Math.floor(Math.random() * queue.length); }
    while (nextIdx === index);
  }
}
```

**Por qué el do-while**: Math.random puede dar el mismo índice. Para una cola de 2 tracks en shuffle, el 50% de las veces daría el mismo. El loop garantiza que nunca se repite el actual (a menos que solo haya 1 track).

### 3. `prev()`: comportamiento "de Spotify"
`packages/ui/src/stores/player.js:185-199`

```js
if (positionSeconds > 3) {
  set({ positionSeconds: 0 });
  return true;
}
const prevIdx = Math.max(0, index - 1);
```

**Por qué 3 segundos**: si llevas > 3s en el track actual y pulsas "anterior", vuelves al inicio de ese track (no al anterior). Esto es el comportamiento estándar de Spotify/Apple Music. Si llevas < 3s, va al track anterior. Evita la frustración de perder una canción accidentalmente al inicio.

### 4. Radio Mode: seed fijo entre batches
`packages/ui/src/stores/player.js:204-218`

```js
startRadio() {
  const cur = get().currentTrack;
  if (!cur) return;
  set({ radioMode: true, radioSeedArtist: cur.artist ?? null });
},
appendQueue(tracks) {
  set((s) => ({ queue: [...s.queue, ...tracks] }));
},
```

**Por qué `radioSeedArtist` fijo en lugar de basarse en `currentTrack.artist`**: a medida que el radio avanza, `currentTrack` cambia. Si el seed cambiara en cada batch, cada tanda de tracks nuevos sería de un artista diferente. El usuario activó el radio con "Arctic Monkeys" → todos los batches deben basarse en Arctic Monkeys. El hook [[use-radio]] lee `radioSeedArtist` para pedir el siguiente batch.

## Casos de borde

- **`playNow([])` con array vacío**: guard `if (tracks.length === 0) return`. No rompe el estado.
- **`removeFromQueue` del último track**: `queue: [], index: -1, currentTrack: null, isPlaying: false`. El motor de audio ([[use-player]]) debe detectar `currentTrack: null` y pausar.
- **`patch({ isPlaying: true })` directo sin track**: posible vía `patch`. El motor intentará reproducir sin URL → error. No hay validación aquí — responsabilidad del caller.
- **`cycleRepeat` order**: `off → all → one → off`. NO `off → one → all` (que sería menos intuitivo). Ver el `get().repeat === 'off' ? 'all' : ...`.

## Performance

El store es síncrono (Zustand). La única operación costosa es `queue.slice()` + `splice` en arrays grandes. Para coleciones típicas (< 500 tracks) es irrelevante. No hay queries DB ni network en este store.

## Dependencias entrantes
- [[use-player]] hook → lee todo el estado, llama `patch`, `next`, `prev`.
- [[QueuePanel]] componente → `removeFromQueue`, `moveQueueItem`, `clearQueue`.
- [[Player]] componente → `togglePlay`, `setVolume`, `toggleShuffle`, `cycleRepeat`.
- [[library]] store → `persistEphemeral` llama `patch` para swap de currentTrack.
- [[use-radio]] hook → `appendQueue`, `startRadio`, `stopRadio`.

## Dependencias salientes
- Ninguna (Zustand puro, sin imports de red o APIs).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `moveQueueItem` sin ajustar index | `currentTrack` y `queue[index]` desincronizados → reproduce el track incorrecto. |
| `prev()` sin el threshold de 3s | Doble-click en "anterior" siempre retrocede 2 tracks en lugar de reiniciar. |
| `shuffle` do-while sin guard `queue.length === 1` | Loop infinito para colas de 1 track. |
| `radioSeedArtist` que sigue al currentTrack | Cada batch de radio es de un artista diferente → no es radio de un artista. |
| `playNow` que no resetea `positionSeconds` | Nuevo track comienza en la posición del anterior → seek falso. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-31 (**fix sync Jam**): el store ahora se crea con el middleware
  `subscribeWithSelector` (`create(subscribeWithSelector((set,get)=>({...})))`). Habilita la
  firma `subscribe(selector, listener)` que usan [[use-jam-sync]] y [[use-presence]]. Sin él,
  zustand 5 ignoraba el listener y el host del Jam nunca propagaba el track. Ver
  [[Decisiones-Tecnicas-ADR|ADR-023]]. ⚠️ No quitar el middleware: rompe el broadcast del Jam
  y la presencia.
