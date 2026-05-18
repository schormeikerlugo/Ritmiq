/**
 * Busqueda local-first sobre la biblioteca del usuario.
 *
 * Filtra `useLibraryStore.tracks` por una query usando tokens AND
 * (todos los tokens deben matchear en title + artist + album), estilo
 * Spotify. La biblioteca cabe en memoria (<10k tracks tipico) asi que
 * el filtro O(n) por keystroke es despreciable (~1ms).
 *
 * Tambien expone `dedupeByYtId` para sacar de la lista de resultados
 * YouTube cualquier video cuyo ytId ya este en la biblioteca local —
 * evita mostrar el mismo track dos veces en el dropdown / SearchView.
 *
 * @module @ritmiq/ui/lib/library-search
 */

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 */

/**
 * Normaliza un string para matching: lowercase + sin diacriticos +
 * colapsa espacios. "Café Tacvba" -> "cafe tacvba".
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remover diacriticos
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokeniza una query por espacios. Tokens vacios se descartan.
 *
 * @param {string} query
 * @returns {string[]}
 */
function tokenize(query) {
  return normalize(query).split(' ').filter(Boolean);
}

/**
 * Busca tracks locales que matchen TODOS los tokens de la query en
 * (title + artist + album). Devuelve tracks ordenados por relevancia
 * basica: prefiere matches que empiecen con el primer token sobre los
 * que solo lo contienen, despues alfabetico por title.
 *
 * @param {Track[]} tracks  Biblioteca del usuario (de useLibraryStore).
 * @param {string} query
 * @param {number} [limit=5]
 * @returns {Track[]}
 */
export function searchLibraryTracks(tracks, query, limit = 5) {
  const tokens = tokenize(query);
  if (tokens.length === 0 || !Array.isArray(tracks) || tracks.length === 0) {
    return [];
  }

  /** @type {Array<{ track: Track, score: number }>} */
  const scored = [];
  for (const t of tracks) {
    const haystack = normalize(
      `${t.title ?? ''} ${t.artist ?? ''} ${t.album ?? ''}`
    );
    if (!haystack) continue;

    // AND: todos los tokens deben aparecer en alguna parte del haystack.
    let allMatch = true;
    for (const tok of tokens) {
      if (!haystack.includes(tok)) { allMatch = false; break; }
    }
    if (!allMatch) continue;

    // Score: el primer token al inicio del title vale mas (prefijo).
    // Despues solo importa que matchee.
    const titleNorm = normalize(t.title ?? '');
    let score = 1;
    if (titleNorm.startsWith(tokens[0])) score += 10;
    if (titleNorm.includes(tokens[0])) score += 1;

    scored.push({ track: t, score });
    // Pequeña optimizacion: si ya tenemos 4x el limit, paramos —
    // no vamos a sortear miles de tracks si solo mostramos 5.
    if (scored.length >= limit * 4) break;
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return normalize(a.track.title ?? '').localeCompare(normalize(b.track.title ?? ''));
  });

  return scored.slice(0, limit).map((x) => x.track);
}

/**
 * Filtra resultados de YouTube sacando los que tienen ytId ya presente
 * en `localTracks`. Esto evita mostrar el mismo track dos veces (una
 * vez como "En tu biblioteca" y otra como "YouTube").
 *
 * @template {{ id: string }} R  Resultado de YouTube: lleva `id` que es el ytId.
 * @param {R[]} youtubeResults
 * @param {Track[]} localTracks
 * @returns {R[]}
 */
export function dedupeByYtId(youtubeResults, localTracks) {
  if (!Array.isArray(youtubeResults) || youtubeResults.length === 0) return [];
  if (!Array.isArray(localTracks) || localTracks.length === 0) return youtubeResults;
  const localYtIds = new Set();
  for (const t of localTracks) {
    if (t.ytId) localYtIds.add(t.ytId);
  }
  if (localYtIds.size === 0) return youtubeResults;
  return youtubeResults.filter((r) => !localYtIds.has(r.id));
}
