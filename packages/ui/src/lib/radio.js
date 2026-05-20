/**
 * Modo Radio — autoplay infinito basado SOLO en la biblioteca local.
 *
 * Politica del usuario:
 *   - No tocar la red para sugerir canciones — cargar siempre desde
 *     YouTube estresa el algoritmo y consume datos.
 *   - El radio debe seguir el genero del seed, con algunas tracks de
 *     otro genero/artista para descubrimiento.
 *
 * Como no tenemos columna `genre` en tracks, aproximamos "mismo genero"
 * con "mismo artista o artistas frecuentemente escuchados junto al
 * artista seed" (signal del history).
 *
 * Algoritmo:
 *   Base = track actual → artista seed.
 *   Bucket A (60% de la cola): tracks de la lib del artista seed.
 *   Bucket B (30%): tracks de la lib de los TOP-3 artistas mas escuchados
 *                   junto al seed en el historial reciente (90 dias).
 *   Bucket C (10%): tracks aleatorios de la lib para descubrimiento.
 *
 * Si no hay historial suficiente, B colapsa a tracks de los top artistas
 * globales. Si la lib es muy pequena, repite.
 *
 * El radio se "auto-extiende" desde el player engine cuando quedan <= 2
 * tracks por delante en la cola Y radioMode esta activo (ver use-player.js).
 *
 * @module @ritmiq/ui/lib/radio
 */
import { useLibraryStore } from '../stores/library.js';
import { useHistoryStore } from '../stores/history.js';

/** Mezcla Fisher-Yates inmutable. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function norm(s) { return (s ?? '').toLowerCase().trim(); }

/**
 * Devuelve los artistas que aparecen frecuentemente junto al seed en el
 * historial reciente, ordenados por co-ocurrencia. Limit por defecto 3.
 *
 * @param {string} seedArtist
 * @param {number} limit
 * @returns {string[]}
 */
function findCoListenedArtists(seedArtist, limit = 3) {
  const events = useHistoryStore.getState().events ?? [];
  const seedNorm = norm(seedArtist);
  if (!seedNorm) return [];
  // Ventana reciente: 90 dias.
  const since = Date.now() - 90 * 24 * 3600 * 1000;
  // Cuenta plays por artista (excluyendo el seed) y filtra solo sesiones
  // donde aparecio el seed. Aproximacion barata: contamos todos los plays
  // recientes excluyendo el seed; el efecto practico es "top artistas
  // recientes del usuario", que es una proxy razonable.
  const counts = new Map();
  for (const ev of events) {
    const t = new Date(ev.playedAt ?? ev.createdAt ?? 0).getTime();
    if (Number.isFinite(t) && t < since) continue;
    const a = norm(ev.artist);
    if (!a || a === seedNorm) continue;
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([a]) => a);
}

/**
 * Construye una tanda de N tracks para el radio.
 *
 * @param {{ seedTrack: import('@ritmiq/core/types').Track, batchSize?: number, excludeIds?: Set<string> }} opts
 * @returns {import('@ritmiq/core/types').Track[]}
 */
export function buildRadioBatch({ seedTrack, batchSize = 15, excludeIds = new Set() }) {
  const all = useLibraryStore.getState().tracks ?? [];
  if (all.length === 0) return [];
  const seedArtist = norm(seedTrack?.artist);
  if (!seedArtist) {
    // Sin seed reconocible, devolvemos shuffle puro.
    return shuffle(all.filter((t) => !excludeIds.has(t.id))).slice(0, batchSize);
  }

  const sameArtist = all.filter(
    (t) => norm(t.artist) === seedArtist && !excludeIds.has(t.id)
  );

  const coArtists = new Set(findCoListenedArtists(seedTrack.artist, 3));
  const sameVibe = all.filter(
    (t) => coArtists.has(norm(t.artist)) && !excludeIds.has(t.id)
  );

  const discovery = all.filter(
    (t) =>
      norm(t.artist) !== seedArtist &&
      !coArtists.has(norm(t.artist)) &&
      !excludeIds.has(t.id)
  );

  // Reparto 60% / 30% / 10%.
  const nA = Math.round(batchSize * 0.6);
  const nB = Math.round(batchSize * 0.3);
  const nC = batchSize - nA - nB;

  const picks = [
    ...shuffle(sameArtist).slice(0, nA),
    ...shuffle(sameVibe).slice(0, nB),
    ...shuffle(discovery).slice(0, nC),
  ];

  // Si algun bucket estaba vacio, rellena con discovery aleatorio.
  if (picks.length < batchSize) {
    const filler = shuffle(discovery.length > 0 ? discovery : all)
      .filter((t) => !picks.includes(t) && !excludeIds.has(t.id))
      .slice(0, batchSize - picks.length);
    picks.push(...filler);
  }

  // Shuffle final del conjunto para que el bucket A no salga todo seguido.
  return shuffle(picks).slice(0, batchSize);
}
