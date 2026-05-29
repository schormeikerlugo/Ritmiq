/**
 * time-of-day — heuristica para reordenar recomendaciones segun la
 * hora local del usuario.
 *
 * El servidor devuelve tracks ordenados por relevancia raw de Last.fm.
 * Esta lib aplica un re-scoring suave en el cliente que sube tracks
 * cuyo genero matchea el "mood" de la franja horaria actual.
 *
 * No filtra (no elimina ningun track) — solo reordena. Asi nunca pierde
 * variedad ni se siente robotico.
 *
 * Franjas:
 *   morning   06:00-11:59  →  bias energetico
 *   afternoon 12:00-17:59  →  sin bias (orden raw del server)
 *   evening   18:00-22:59  →  bias mellow suave
 *   night     23:00-05:59  →  bias mellow fuerte
 *
 * @module @ritmiq/ui/lib/time-of-day
 */

/** Generos con energia alta — favoritos en la manana. */
const ENERGETIC_TAGS = new Set([
  'rock', 'pop', 'hip-hop', 'hip hop', 'hiphop', 'rap', 'electronic',
  'electro', 'dance', 'edm', 'house', 'techno', 'trance', 'punk',
  'metal', 'reggaeton', 'salsa', 'cumbia', 'merengue', 'funk',
  'disco', 'alternative rock', 'indie rock', 'pop rock', 'k-pop', 'kpop',
]);

/** Generos suaves — favoritos en la noche. */
const MELLOW_TAGS = new Set([
  'ambient', 'chill', 'chillout', 'lofi', 'lo-fi', 'lo fi',
  'acoustic', 'jazz', 'classical', 'piano', 'soul', 'rnb', 'r&b',
  'bossa nova', 'indie folk', 'singer-songwriter', 'folk',
  'instrumental', 'meditation', 'sleep', 'soundtrack', 'cinematic',
  'downtempo', 'trip-hop', 'trip hop', 'neo-soul',
]);

/**
 * Determina la franja horaria activa.
 * @param {Date} [now=new Date()]
 * @returns {'morning' | 'afternoon' | 'evening' | 'night'}
 */
export function getTimeOfDay(now = new Date()) {
  const h = now.getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

/**
 * Devuelve el "mood bias" actual.
 * @param {Date} [now]
 * @returns {'energetic' | 'mellow' | null}
 */
export function getMoodBias(now) {
  const tod = getTimeOfDay(now);
  if (tod === 'morning') return 'energetic';
  if (tod === 'night') return 'mellow';
  if (tod === 'evening') return 'mellow';
  return null;
}

/**
 * Normaliza un string a la convencion de TAG_BLACKLIST/ENERGETIC/MELLOW
 * (lowercase, trim).
 */
function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Calcula el score de un track segun el mood. Mayor = sube en el orden.
 *
 * Heuristica simple:
 *   - Match exacto en ENERGETIC + mood='energetic' → +1.0
 *   - Match exacto en MELLOW    + mood='mellow'    → +1.0
 *   - Mismatch (mellow track en mood energetic, o viceversa) → -0.5
 *   - Sin info de genero → 0 (no afecta).
 *
 * El bias es **chico a proposito** para que tracks muy relevantes del
 * server (los primeros 3-5) sigan arriba aunque no matcheen el mood.
 */
function trackMoodScore(track, mood) {
  if (!track || !mood) return 0;
  // Los recs de Last.fm tipicamente no traen genero por track; usamos
  // el artista como proxy via el `tags` opcional o el `reason`.
  // Hoy el server no devuelve genre por track, solo `artist`. Sin esa
  // info aqui retornamos 0 (el reordenamiento queda neutral).
  // Esta es la "puerta trasera" del feature: si en el futuro se anade
  // `track.tags` al payload, este score lo aprovechara automaticamente.
  const tags = Array.isArray(track.tags) ? track.tags.map(norm) : [];
  if (tags.length === 0) return 0;

  let matchedSame = 0;
  let matchedOpposite = 0;
  for (const t of tags) {
    if (mood === 'energetic') {
      if (ENERGETIC_TAGS.has(t)) matchedSame++;
      if (MELLOW_TAGS.has(t)) matchedOpposite++;
    } else if (mood === 'mellow') {
      if (MELLOW_TAGS.has(t)) matchedSame++;
      if (ENERGETIC_TAGS.has(t)) matchedOpposite++;
    }
  }
  return matchedSame * 1.0 - matchedOpposite * 0.5;
}

/**
 * Reordena una lista de tracks segun el mood actual. **No filtra** — solo
 * sube los tracks que matchean el mood y baja los que claramente no.
 *
 * @template T
 * @param {T[]} tracks
 * @param {{ now?: Date, mood?: 'energetic'|'mellow'|null }} [opts]
 * @returns {T[]} nuevo array (input no mutado).
 */
export function reorderByMood(tracks, opts = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks ?? [];
  const mood = opts.mood ?? getMoodBias(opts.now);
  if (!mood) return tracks; // afternoon, sin re-ordering

  // Calcula score combinado: posicion original + ajuste de mood.
  // El ajuste es chico (max ±1.0) para que el top del server siga arriba.
  const scored = tracks.map((t, idx) => ({
    t,
    // Posicion original como score negativo (mas alta posicion = mejor).
    score: -idx + trackMoodScore(t, mood),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.t);
}

/**
 * Saludo amigable segun la hora.
 * @param {Date} [now]
 */
export function getGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 6)  return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Subtitle contextual para una fila de recomendaciones segun el mood.
 * @param {'morning'|'afternoon'|'evening'|'night'} [tod]
 */
export function getMoodSubtitle(tod) {
  const t = tod ?? getTimeOfDay();
  switch (t) {
    case 'morning':   return 'Energía para empezar el día';
    case 'evening':   return 'Suave para la tarde';
    case 'night':     return 'Para acompañar la noche';
    case 'afternoon':
    default:          return 'Lo que más escuchas';
  }
}
