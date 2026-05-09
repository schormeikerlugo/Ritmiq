import { useEffect, useState } from 'react';
import { useImportStore } from '../../stores/import.js';
import { useViewStore } from '../../stores/view.js';
import { getLanBaseUrlSync } from '../../lib/lan-client.js';
import styles from './SpotifyImportDialog.module.css';

function fmtDur(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** @param {{ onClose: () => void }} props */
export function SpotifyImportDialog({ onClose }) {
  const { loading, importing, done, error, source, items, createdPlaylistId,
          preview, import: doImport, reset } = useImportStore();

  const goPlaylist = useViewStore((s) => s.goPlaylist);

  const [url, setUrl] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !importing) closeAll(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const closeAll = () => {
    reset();
    onClose();
  };

  const lanReady = !!getLanBaseUrlSync() || typeof window === 'undefined' || /* desktop ignora LAN config */ Boolean(window.ritmiq);

  const matched = items.filter((i) => i.status === 'persisted').length;
  const errored = items.filter((i) => i.status === 'error').length;
  const total = items.length;
  const progress = total > 0 ? Math.round(((matched + errored) / total) * 100) : 0;

  const onPreview = (e) => {
    e?.preventDefault?.();
    if (!url.trim()) return;
    preview(url.trim());
  };

  const onGoToPlaylist = () => {
    if (createdPlaylistId) goPlaylist(createdPlaylistId);
    closeAll();
  };

  return (
    <div
      className={styles.backdrop}
      onClick={() => { if (!importing) closeAll(); }}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>Importar desde Spotify</h2>
          <button
            className={styles.close}
            onClick={closeAll}
            disabled={importing}
            aria-label="Cerrar"
          >×</button>
        </header>

        {!lanReady && (
          <p className={styles.warning}>
            Para importar de Spotify necesitas conexión con tu PC. Configúrala en Ajustes.
          </p>
        )}

        {!source && !done && (
          <form className={styles.urlForm} onSubmit={onPreview}>
            <p className={styles.intro}>
              Pega el link de una playlist pública de Spotify. La app buscará
              cada canción en YouTube y creará una playlist nueva con las
              coincidencias.
            </p>
            <input
              className={styles.input}
              type="url"
              placeholder="https://open.spotify.com/playlist/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading || !lanReady}
              autoFocus
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={closeAll}
              >Cancelar</button>
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={loading || !url.trim() || !lanReady}
              >{loading ? 'Cargando…' : 'Cargar playlist'}</button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
          </form>
        )}

        {source && !done && (
          <>
            <div className={styles.preview}>
              {source.coverUrl && (
                <img className={styles.cover} src={source.coverUrl} alt="" />
              )}
              <div className={styles.previewMeta}>
                <span className={styles.kind}>Playlist de Spotify</span>
                <h3 className={styles.previewTitle}>{source.name}</h3>
                <span className={styles.count}>
                  {items.length} {items.length === 1 ? 'canción' : 'canciones'}
                  {importing && ` · ${matched + errored}/${items.length}`}
                </span>
                {source.description && (
                  <p className={styles.description}>{source.description}</p>
                )}
              </div>
            </div>

            {importing && (
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
            )}

            <ul className={styles.list}>
              {items.slice(0, importing ? items.length : 30).map((it, i) => (
                <li key={i} className={styles.row} data-status={it.status}>
                  <span className={styles.idx}>{i + 1}</span>
                  <div className={styles.rowMeta}>
                    <span className={styles.rowTitle}>{it.title}</span>
                    <span className={styles.rowArtist}>{it.artist}</span>
                  </div>
                  <span className={styles.rowDur}>{fmtDur(it.durationMs)}</span>
                  <span className={styles.statusIcon} aria-hidden="true">
                    {it.status === 'pending'   ? '○'
                    : it.status === 'matching' ? '⟳'
                    : it.status === 'matched'  ? '◔'
                    : it.status === 'persisted'? '✓'
                    : '⚠'}
                  </span>
                </li>
              ))}
              {!importing && items.length > 30 && (
                <li className={styles.muted}>
                  …y {items.length - 30} canciones más.
                </li>
              )}
            </ul>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button
                className={styles.btnSecondary}
                onClick={closeAll}
                disabled={importing}
              >{importing ? 'Importando…' : 'Cancelar'}</button>
              <button
                className={styles.btnPrimary}
                onClick={doImport}
                disabled={importing}
              >Importar {items.length} canciones</button>
            </div>
          </>
        )}

        {done && (
          <div className={styles.summary}>
            <div className={styles.summaryIcon}>✓</div>
            <h3 className={styles.summaryTitle}>Importación completada</h3>
            <p className={styles.summaryText}>
              {matched} canciones importadas{errored > 0 ? `, ${errored} con error` : ''}.
            </p>
            <div className={styles.actions}>
              <button className={styles.btnSecondary} onClick={closeAll}>
                Cerrar
              </button>
              <button className={styles.btnPrimary} onClick={onGoToPlaylist}>
                Abrir playlist
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
