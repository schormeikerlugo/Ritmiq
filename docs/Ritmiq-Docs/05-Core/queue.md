---
tipo: modulo
capa: core
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/core/src/queue/index.js
tags: [core, queue, shuffle, repeat]
---

# `core/queue/index.js`

> Clase `Queue`: cola de reproducción con shuffle (Fisher-Yates) y repeat (`off`/`one`/`all`). Completamente síncrona y sin side-effects. Pura lógica de dominio.

## Ubicación
`packages/core/src/queue/index.js:1` (90 líneas)

## API

```js
class Queue {
  constructor({ tracks?: Track[], index?: number, shuffle?: boolean, repeat?: RepeatMode })

  current(): Track | null
  next(): Track | null
  prev(): Track | null
  setShuffle(on: boolean): void
  setRepeat(mode: 'off'|'one'|'all'): void
  enqueue(track: Track): void
}
```

Propiedades públicas (lectura directa):
- `tracks: Track[]` — array original (orden de inserción).
- `order: Track[]` — array de reproducción (= `tracks` o shuffled).
- `index: number` — posición actual en `order`.
- `shuffle: boolean`.
- `repeat: 'off'|'one'|'all'`.

## Anatomía del código (snippets clave)

### 1. Dos arrays: `tracks` vs `order`
`packages/core/src/queue/index.js:32-41`

```js
constructor(opts = {}) {
  this.tracks = opts.tracks ?? [];
  this.order  = opts.shuffle ? shuffleArray(this.tracks) : this.tracks.slice();
  this.index  = opts.index ?? 0;
  this.shuffle = opts.shuffle ?? false;
  this.repeat  = opts.repeat ?? 'off';
}
```

**Por qué dos arrays**: `tracks` es el orden original (lo que el usuario ve en la UI, lo que se guarda). `order` es por lo que se navega al reproducir. Sin esta separación, al desactivar shuffle perderías el orden original.

`this.tracks.slice()` en modo no-shuffle crea una copia — importante porque si mutamos `tracks` (ej. `enqueue`), `order` no queda automáticamente sincronizado.

### 2. `next()` con lógica de repeat
`packages/core/src/queue/index.js:48-60`

```js
next() {
  if (this.repeat === 'one') return this.current();
  if (this.index < this.order.length - 1) {
    this.index++;
    return this.current();
  }
  if (this.repeat === 'all') {
    this.index = 0;
    return this.current();
  }
  return null; // fin de cola, sin repeat
}
```

**Por qué `'one'` devuelve `current()` sin avanzar**: al repetir una canción, el caller ([[use-player]]) pide `next()` cuando termina; si devolvemos el mismo track, [[Player]] lo recarga desde el inicio. Evita que el caller tenga que saber si hay repeat one activo.

### 3. `setShuffle` preserva el track actual
`packages/core/src/queue/index.js:71-78`

```js
setShuffle(on) {
  if (on === this.shuffle) return;
  const cur = this.current(); // guarda ref antes de reordenar
  this.shuffle = on;
  this.order = on ? shuffleArray(this.tracks) : this.tracks.slice();
  if (cur) this.index = Math.max(0, this.order.indexOf(cur));
}
```

**Por qué preservar el track actual**: si el usuario activa shuffle mientras escucha la canción 3, queremos que la canción 3 siga siendo la actual en el nuevo orden. Sin `indexOf(cur)`, el index quedaría apuntando a una canción aleatoria → salto inesperado.

### 4. `enqueue` añade a ambos arrays
`packages/core/src/queue/index.js:85-89`

```js
enqueue(track) {
  this.tracks.push(track);
  this.order.push(track);
}
```

**Por qué push a `order` siempre al final aunque esté shuffled**: "Add to queue" semánticamente significa "reproducir esta canción después de lo que viene". En modo shuffle, lo ponemos al final del orden actual. Alternativa (no implementada): insertarlo como `order[index + 1]` para "reproducir JUSTO después" — si alguna vez ves esta feature solicitada, implementarla aquí.

## Casos de borde y gotchas

- **Cola vacía**: `current()` devuelve `null`. `next()` y `prev()` también. El caller debe manejar `null` antes de llamar `playTrack`.
- **`index` fuera de rango**: no hay validación de bounds en `setShuffle`. Si `this.order` por alguna razón tiene menos elementos que `this.index`, `current()` devuelve `undefined` (no `null`). Defensivo: el caller debería chequear `?? null`.
- **`enqueue` en cola shuffled**: el nuevo track siempre va al final del `order` shuffled, no en posición aleatoria. Es el comportamiento esperado para "Add to queue".
- **Mutación externa de `tracks`**: si alguien hace `queue.tracks.push(x)` sin llamar `enqueue`, `order` queda desincronizado. No hay getter defensivo — confiamos en usar la API pública.

## Dependencias entrantes
- [[use-player]] (crea la instancia, llama next/prev/setShuffle/setRepeat).
- [[player-store|stores/player]] (puede serializar/restaurar la queue entre sesiones).

## Dependencias salientes
- [[types|core/types]] (`Track`, `RepeatMode`).
- Ninguna runtime — pura lógica.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar la copia `this.tracks.slice()` en no-shuffle | `order` es la misma ref que `tracks`; mutaciones de uno afectan el otro. |
| `setShuffle` sin preservar track actual | Activar/desactivar shuffle cambia la canción que se está reproduciendo. |
| `next()` con `'one'` que avanza el index | La canción en repeat one no se repite → pasa a la siguiente. |
| `enqueue` solo en `tracks` pero no `order` | Track añadido nunca aparece en la reproducción hasta reiniciar la queue. |

## Notas / Changelog
- 2026-05-22: nivel medio.
