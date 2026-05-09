/**
 * Exportadores de playlists en JSON/CSV. Compatibles con Soundiiz/TuneMyMusic.
 */

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 * @typedef {import('@ritmiq/core/types').Playlist} Playlist
 */

/** @param {string} s */
function safeFilename(s) {
  return (s ?? 'playlist').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

/** Dispara la descarga de un Blob con el nombre indicado. */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {Playlist} playlist
 * @param {Track[]} tracks
 */
export function exportPlaylistJson(playlist, tracks) {
  const payload = {
    name: playlist.name,
    exportedAt: new Date().toISOString(),
    tracksCount: tracks.length,
    tracks: tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationSeconds: t.durationSeconds,
      source: t.source,
      ytId: t.ytId,
      coverUrl: t.coverUrl,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, `${safeFilename(playlist.name)}.json`);
}

/**
 * Escapa un campo CSV según RFC 4180: si contiene `,`, `"` o saltos de línea
 * lo entrecomilla y duplica las comillas internas.
 *
 * @param {unknown} v
 */
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Playlist} playlist
 * @param {Track[]} tracks
 */
export function exportPlaylistCsv(playlist, tracks) {
  const headers = ['Title', 'Artist', 'Album', 'Duration', 'Source', 'YouTube ID'];
  const rows = tracks.map((t) => [
    t.title,
    t.artist ?? '',
    t.album ?? '',
    t.durationSeconds ?? '',
    t.source,
    t.ytId ?? '',
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `${safeFilename(playlist.name)}.csv`);
}
