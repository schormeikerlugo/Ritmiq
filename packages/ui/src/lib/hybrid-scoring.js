/**
 * hybrid-scoring \u2014 combina recomendaciones de multiples fuentes en una
 * lista unica con scoring hibrido.
 *
 * Cada fuente entrega tracks ordenados por relevancia raw. Asignamos un
 * score normalizado [0, 1] a cada track segun su posicion + un peso por
 * fuente. Tracks que aparecen en MAS de una fuente reciben boost
 * (consensus boost), porque dos fuentes coinciden = mejor senal.
 *
 * Source weights (defaults):
 *   - lastfm:  1.0   (calidad consistente, buena diversidad)
 *   - yt:      0.85  (mas variedad pero ruido en artist field)
 *   - spotify: 1.1   (reserved; mejor calidad si OAuth)
 *
 * Consensus boost: si un track aparece en 2 fuentes, sumar 0.5 al score.
 * Si en 3, sumar 1.0. Casi siempre lo mueve al top.
 *
 * Dedup: por ytId. Si un track no tiene ytId, se descarta (no es
 * reproducible).
 *
 * @module @ritmiq/ui/lib/hybrid-scoring
 */

const SOURCE_WEIGHTS = {
  lastfm: 1.0,
  yt: 0.85,
  spotify: 1.1,
};

const CONSENSUS_BOOST_PER_EXTRA_SOURCE = 0.5;

/**
 * @param {string} source identificador de la fuente
 * @param {Array<any>} tracks tracks normalizados (con .ytId, .title, .artist, ...)
 * @returns {Map<string, { track: any, score: number, sources: Set<string> }>}
 */
function scoreTracks(source, tracks) {
  const weight = SOURCE_WEIGHTS[source] ?? 1.0;
  const map = new Map();
  const n = tracks.length;
  for (let i = 0; i < n; i++) {
    const t = tracks[i];
    if (!t?.ytId) continue;
    // Score por posicion: el primer track vale 1.0, el ultimo vale 0.
    const posScore = n === 1 ? 1 : 1 - (i / (n - 1));
    const score = posScore * weight;
    map.set(t.ytId, { track: t, score, sources: new Set([source]) });
  }
  return map;
}

/**
 * Mergea N maps de tracks scored, aplicando consensus boost a tracks
 * que aparecen en > 1 fuente.
 *
 * @param  {...Map<string, {track:any, score:number, sources:Set<string>}>} maps
 * @returns {Array<{track:any, score:number, sources:string[]}>}
 */
function mergeAndBoost(...maps) {
  const merged = new Map();
  for (const m of maps) {
    for (const [ytId, entry] of m) {
      const existing = merged.get(ytId);
      if (existing) {
        existing.score += entry.score;
        for (const s of entry.sources) existing.sources.add(s);
      } else {
        merged.set(ytId, {
          track: entry.track,
          score: entry.score,
          sources: new Set(entry.sources),
        });
      }
    }
  }
  // Aplicar consensus boost.
  for (const entry of merged.values()) {
    if (entry.sources.size > 1) {
      entry.score += CONSENSUS_BOOST_PER_EXTRA_SOURCE * (entry.sources.size - 1);
    }
  }
  // Sort desc por score.
  const out = Array.from(merged.values()).map((e) => ({
    track: e.track,
    score: e.score,
    sources: Array.from(e.sources),
  }));
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Combina arrays de tracks de multiples fuentes en una lista unica.
 * Devuelve los tracks ordenados por score hibrido descendente.
 *
 * @param {Array<{ source: string, tracks: any[] }>} sources
 * @param {{ limit?: number }} [opts]
 * @returns {any[]} tracks ordenados (sin el wrapping { track, score, sources })
 */
export function combineSources(sources, opts = {}) {
  if (!Array.isArray(sources) || sources.length === 0) return [];

  // Filtrar fuentes vacias.
  const valid = sources.filter((s) => Array.isArray(s?.tracks) && s.tracks.length > 0);
  if (valid.length === 0) return [];

  // Si solo hay una fuente, devolverla tal cual (sin recomputar score).
  if (valid.length === 1) {
    const out = valid[0].tracks
      .filter((t) => t?.ytId)
      .slice(0, opts.limit ?? Infinity);
    return out;
  }

  const maps = valid.map((s) => scoreTracks(s.source, s.tracks));
  const merged = mergeAndBoost(...maps);
  const limit = opts.limit ?? Infinity;
  return merged.slice(0, limit).map((e) => {
    // Aprovechar para enriquecer track.reason con las fuentes que
    // contribuyeron. Util para tooltip / debug.
    return {
      ...e.track,
      hybridScore: Math.round(e.score * 100) / 100,
      hybridSources: e.sources,
    };
  });
}

/**
 * Version mas simple: combina 2 fuentes nombradas con sus respectivos
 * tracks. Wrapper conveniente cuando solo hay dos.
 */
export function combineTwoSources(sourceA, tracksA, sourceB, tracksB, opts) {
  return combineSources([
    { source: sourceA, tracks: tracksA ?? [] },
    { source: sourceB, tracks: tracksB ?? [] },
  ], opts);
}
