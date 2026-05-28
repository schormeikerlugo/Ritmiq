---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/primitives/CoverArt.jsx
tags: [componente, primitive, cover, gradient, hash, placeholder]
---

# `<CoverArt>`

> Primitive que muestra una carátula con fallback a gradient HSL determinístico generado por hash del `seed`. Mismo seed → mismo gradient siempre. Reemplaza el patrón repetido `cover ? <img/> : <placeholder/>` que vivía en ~15 componentes.

## Ubicación
`packages/ui/src/components/primitives/CoverArt.jsx:1` (~125 líneas)

## Por qué existe

Ver [[Decisiones-Tecnicas-ADR|ADR-009]]. Tracks sin `coverUrl` mostraban hueco gris o icono `<Music>` plano. Visualmente inconsistente entre sesiones porque cada componente decidía su propio fallback.

## Props

```js
<CoverArt
  coverUrl={track.coverUrl}
  seed={track.title || track.artist || 'ritmiq'}
  alt=""
  size={56}                         // number | string | undefined (hereda)
  radius="sm"                        // 'sm'|'md'|'lg'|'pill'|'circle'|number
  initials={true}                    // boolean | string (custom)
  loading="lazy"
  className={extraClasses}
  onClick={fn}
/>
```

| Prop | Tipo | Default | Notas |
|---|---|---|---|
| `coverUrl` | `string \| null` | — | Si existe y no falla, renderiza `<img>` |
| `seed` | `string` | `''` | Para hash → gradient + iniciales |
| `alt` | `string` | `''` | Usado como fallback de seed si `seed` está vacío |
| `size` | `number \| string` | undefined | `width` + `height`; undefined hereda del padre |
| `radius` | `enum \| number` | `'sm'` | Token CSS o px raw |
| `initials` | `boolean \| string` | `true` | `false`: sin texto. `string`: ese texto. `true`: deriva de seed |
| `loading` | `'lazy' \| 'eager'` | `'lazy'` | Pasado al `<img>` cuando aplica |
| `className` | `string` | — | Extra classes para el wrapper |
| `onClick` | `() => void` | — | Si presente, agrega `role="button"` y `tabIndex={0}` |

## Hash FNV-1a 32-bit

```js
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}
```

Rápido, sin libs, sin colisiones perceptibles para los volúmenes de seed que manejamos.

## Gradient

```js
const hue1 = h % 360;
const hue2 = (hue1 + 40 + ((h >> 8) % 60)) % 360;  // separación 40-100°
// linear-gradient(135deg, hsl(hue1 65% 38%), hsl(hue2 60% 28%))
```

## Iniciales

`deriveInitials(seed)`:

- 1 palabra → primera letra mayúscula. Ej: `"Bohemian"` → `"B"`.
- 2+ palabras → primera letra de las 2 primeras. Ej: `"Bad Bunny"` → `"BB"`.

## Fallback automático

```jsx
<img onError={() => setImgFailed(true)} />
```

Si la imagen falla en cargar (404, CORS, network), se cambia a gradient sin recargar el componente.

## Dónde se usa

| Componente | Uso |
|---|---|
| [[TrackCard]] | Cards horizontales en [[Home]] (Fase 2.2) |
| [[YtPlaylistView]] | Track rows |
| [[HistoryView]] | Track rows |
| [[MonthlyWrapped]] | Top 3 tracks |

## Dónde **no** se usa (y por qué)

- [[Player]] mini-player cover: revertido a `<img>` directo en commit `270da70` para mantener la animación `vinyl-spin` que dependía del `<img>` siendo hijo directo del wrapper `.cover` (selector `.cover img`).

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar el algoritmo de hash | Los gradients existentes cambian de color para el mismo seed |
| Quitar `onError` | Imágenes rotas se quedan como hueco |
| Cambiar el rango de saturation/lightness HSL | Coherencia visual con el resto de la app afectada |

## Casos de borde

- **`seed` vacío y `alt` vacío**: usa hash de string vacío → gradient default morado.
- **`coverUrl` válida pero CORS error**: el `onError` dispara → fallback a gradient + iniciales del seed.
- **`size` no definido**: el wrapper hereda del flex parent. Útil cuando vives dentro de un grid.

## Changelog

- 2026-05-27 — Creado en Fase 2.2. Commit `233f859`. Reverso parcial en commit `270da70` para mini-player.
