---
tipo: modulo
capa: core
plataforma: ambas
estado: estable
ultima-revision: 2026-05-24
archivo: packages/core/src/clean-track-meta/
tags: [core, utility, cleaning, p2p]
created: 2026-05-24
---

# clean-track-meta — Utility canónica de limpieza de metadata

> **Ubicación:** `packages/core/src/clean-track-meta/`
> **Mirror Deno:** `supabase/functions/_shared/clean-track-meta.ts`
> **Consumers:** [[search-youtube]], [[publish-track-meta]], `ipc.js`, `api.js`, `stores/import.js`

## Problema que resuelve

YouTube devuelve títulos sucios cargados de marketing:

```
Waiting For The End (Official Music Video) [4K Upgrade] - Linkin Park
```

Si dejamos esto entrar a [[tracks_global]] (que es **first-write-wins** y compartido entre todos los usuarios), envenena la búsqueda inteligente para siempre. Esta utility centraliza la limpieza en un único punto y se aplica en 4 capas para defense-in-depth.

## Arquitectura modular

```
packages/core/src/clean-track-meta/
├── index.js      → exports públicos
├── patterns.js   → regex idempotentes con whitelist
├── uploader.js   → cleanUploader, isGenericUploader
├── title.js      → cleanYoutubeTitle (orquestador para input YT crudo)
└── normalize.js  → normalizeMeta (para fuentes ya estructuradas)
```

### Por qué duplicar en Deno (`_shared/clean-track-meta.ts`)

Edge Functions corren en Deno con su propio loader. Importar desde `packages/core` requeriría configuración compleja de `deno.json + import_map.json`. Es más mantenible una copia revisada. Cualquier cambio en `patterns.js` debe replicarse en el mirror TypeScript.

## API pública

### `cleanYoutubeTitle({ rawTitle, rawUploader })`

```js
import { cleanYoutubeTitle } from '@ritmiq/core';

const result = cleanYoutubeTitle({
  rawTitle: 'Waiting For The End (Official Music Video) [4K Upgrade]',
  rawUploader: 'Linkin Park',
});
// → { title: 'Waiting For The End', artist: 'Linkin Park', confidence: 'medium' }
```

**Confidence levels:**
- `'high'` — uploader era `"- Topic"` (artista oficial de YouTube Music)
- `'medium'` — split exitoso por separador, o `cleanUploader` devolvió algo
- `'low'` — no se pudo inferir artist confiable

### `cleanUploader(raw)`

```js
cleanUploader('Bad Bunny - Topic')   // → 'Bad Bunny'
cleanUploader('LinkinParkVEVO')      // → 'LinkinPark'
cleanUploader('Dua Lipa VEVO')       // → 'Dua Lipa'
cleanUploader('Oficial Shakira')     // → 'Shakira'
cleanUploader('Kevin Kaarl')         // → 'Kevin Kaarl' (sin cambios)
```

### `normalizeMeta({ title, artist, album })`

Para fuentes ya estructuradas (Spotify, Last.fm). **NO intenta inferir artist del title** — confía en lo que viene.

```js
normalizeMeta({
  title: 'Levitating  (Official Audio)  ',
  artist: 'Dua Lipa',
  album: 'Future Nostalgia',
});
// → { title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia' }
```

## Patrones cubiertos

### Tier 1 — Markers dentro de paréntesis (whitelist)

Eliminados:
- `(Official Music Video)`, `(Official Video)`, `(Official Audio)`
- `(Oficial)`, `(Video Oficial)` — español
- `[HD]`, `[4K]`, `[4K UPGRADE]`, `[1080p]`, `[Remastered 2011]`
- `(Visualizer)`, `(Visualizador)`
- `(Lyric Video)`, `(Lyrics)`, `(Letra)`, `(Letras Oficiales)`
- `(Audio)`, `(Static Video)`, `(MV)`, `(M/V)`

NO eliminados (protegidos):
- `(Sittin' On)` — no matchea whitelist
- `(Live at Wembley)`, `(Acoustic)`, `(Remix)`, `(Live)` — info musical real
- `(feat. X)` — normalizado pero no eliminado

### Tier 1.5 — Trailing sin paréntesis

Eliminados tras separador `-`, `–`, `—`, `|`:
- `- Remastered 2011`
- `| Official Video`
- `– Music Video`

### Tier 1 — Decorativos

Eliminados al **inicio o fin** del título (NUNCA en medio):
- `★ ♪ ► ▶ ♫ ✨ ◆ ◇ ♬ ♩ ♭ ♯ ☆ ⭐` + emojis Unicode

### Tier 2 — Split conservador `Artista - Título`

**Solo aplica si:**
1. El uploader es genérico/sello (VEVO, Topic, Records, Music, etc.).
2. La parte izquierda tiene 1-4 palabras capitalizadas.
3. La parte izquierda NO empieza con `Don't`, `I'm`, `The`, `When`, etc.

Resultado:
- `"Adema - The Way You Like It (Official Video)"` + `"AdemaVEVO"` → title=`The Way You Like It`, artist=`Adema`
- `"Kevin Kaarl - Vamonos a Marte"` + `"Kevin Kaarl"` → sin cambios (uploader no genérico)
- `"Don't Stop Me Now - Remastered 2011"` + `"Queen Official"` → title=`Don't Stop Me Now` (strip trailing pero NO split)

### Feat normalización (NO eliminación)

- `"(Ft. X)"` → `"(feat. X)"`
- `"ft. X"` → `"(feat. X)"`
- `"(ft. X)"` → `"(feat. X)"`

### Uploader cleaning

- `"Bad Bunny - Topic"` → `"Bad Bunny"` + confidence `'high'`
- `"LinkinParkVEVO"` → `"LinkinPark"`
- `"Dua Lipa VEVO"` → `"Dua Lipa"`
- `"Oficial Shakira"` → `"Shakira"`

## Idempotencia garantizada

```js
clean(clean(x)) === clean(x)   // siempre verdadero
```

Garantizado por usar regex con whitelist específica y `String.replace` puro (sin estado). Permite aplicar la utility en múltiples capas (search-youtube + publish-track-meta + ipc.js + api.js) sin doble-cleaning.

## Inputs manuales del usuario — NO aplicar

Cuando el usuario edita un título via [[EditTrackDialog]], **NO se aplica** `cleanYoutubeTitle` a sus inputs. Razones:

- La edición manual es **autoritativa**: el user sabe lo que quiere.
- Aplicar cleaning podría romper su intención (ej. quiere mantener "(Live)" o un emoji estratégico).
- Sería paternalista — si el user pone `"(Official Video)"` deliberadamente, respetarlo.

La utility solo se aplica a inputs **automáticos** (Innertube, yt-dlp metadata, search results) donde el origen ES sucio por naturaleza.

## Integración (defense-in-depth)

### Capa 1: [[search-youtube]] — raíz del problema

```ts
// supabase/functions/search-youtube/index.ts:extractItems
const cleaned = cleanYoutubeTitle({ rawTitle, rawUploader });
videos.push({
  title: cleaned.title || rawTitle,
  uploader: cleaned.artist ?? cleanUploader(rawUploader) ?? rawUploader,
  ...
});
```

Ningún cliente recibe nunca más un título sucio de Innertube.

### Capa 2: [[publish-track-meta]] — defensa

```ts
const cleaned = cleanYoutubeTitle({ rawTitle, rawUploader: rawArtist });
const title = cleaned.title || rawTitle;
const artist = cleaned.artist || rawArtist;
```

Defensa por si un cliente legacy o `publishTrackMetaFromMain` envía título sucio (lee de SQLite con datos previos al fix).

### Capa 3: Desktop `ipc.js`

```js
function cleanMetaInPlace(meta) {
  const cleaned = cleanYoutubeTitle({
    rawTitle: meta.title,
    rawUploader: meta.uploader ?? meta.artist,
  });
  return {
    ...meta,
    title: cleaned.title || meta.title,
    uploader: cleaned.artist ?? cleanUploader(meta.uploader),
    artist: meta.artist ?? cleaned.artist,
  };
}
```

Aplicado en `library:addFromYoutube` (pegar URL directo) y `library:addFromMetadata`.

### Capa 4: PWA `api.js` persistFromMeta

Análogo a Capa 3 para el caso del PWA pegar URL en TopBar.

## Fix colateral: Spotify import

`stores/import.js` antes descartaba el `item.artist` de Spotify (confiable) y usaba `best.uploader` de YouTube (basura). Ahora prioriza Spotify:

```js
artist: item?.artist                              // de Spotify (autoritativo)
     ?? cleaned.artist                            // del cleaning del title
     ?? best.uploader                             // ultimo recurso
     ?? null
```

## Mantenimiento

### Editar la utility

1. Modificar `packages/core/src/clean-track-meta/patterns.js`.
2. **Replicar idénticamente** en `supabase/functions/_shared/clean-track-meta.ts`.
3. Correr el script de tests inline (ver sección abajo).
4. Re-deploy de Edge Functions:
   ```bash
   SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy publish-track-meta --project-ref gukzacuwcaqgkzchghcg
   SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy search-youtube --project-ref gukzacuwcaqgkzchghcg
   ```

### Backfill de tracks_global tras cambio mayor

```bash
# Ver qué cambiaría sin tocar BD:
node scripts/wipe-and-rebackfill-tracks-global.mjs --dry

# Si el sample se ve bien, aplicar en vivo:
node scripts/wipe-and-rebackfill-tracks-global.mjs --live --i-confirm
```

## Cross-references

- [[tracks_global]] — tabla destinataria del cleaning
- [[publish-track-meta]] — Edge que canoniza
- [[search-youtube]] — Edge que limpia en la raíz
- [[p2p-knowledge-sharing]] — flujo completo P2P
