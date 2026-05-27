import { useCallback, useEffect, useRef, useState } from 'react';
import { useImportStore } from '../../stores/import.js';
import { useViewStore } from '../../stores/view.js';
import { getLanBaseUrlSync, getTunnelUrlSync } from '../../lib/lan-client.js';
import { useMobileViewport } from '../../lib/use-mobile-viewport.js';
import { isDesktop } from '../../lib/api.js';
import { Modal } from '../Modal/Modal.jsx';
import { Button, TextField, FormError } from '../primitives/index.js';
import { useBottomSheet } from '../../stores/bottom-sheet.js';
import styles from './SpotifyImportDialog.module.css';

function fmtDur(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/**
 * Cuerpo del dialog — extraido como componente propio para que tenga su
 * propio state local (input url) y pueda re-renderizarse aisladamente
 * sin forzar al BottomSheet a recrearse en cada teclazo. Eso es lo que
 * impedia que el form de importar Spotify respondiera correctamente.
 *
 * @param {{ onClose: () => void }} props
 */
function ImportBody({ onClose }) {
  const { loading, importing, done, error, source, items, createdPlaylistId,
          preview, import: doImport, reset } = useImportStore();
  const goPlaylist = useViewStore((s) => s.goPlaylist);
  const [url, setUrl] = useState('');

  const closeAll = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Desktop siempre lista (yt-dlp + scraper local). PWA: necesita LAN local
  // O tunnel remoto configurado.
  const lanReady = (typeof window !== 'undefined' && Boolean(window.ritmiq))
    || !!getLanBaseUrlSync()
    || !!getTunnelUrlSync();

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
    <>
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
          <TextField
            type="url"
            placeholder="https://open.spotify.com/playlist/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading || !lanReady}
            autoFocus
          />
          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={closeAll}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={loading}
              loadingText="Cargando..."
              disabled={!url.trim() || !lanReady}
            >
              Cargar playlist
            </Button>
          </div>
          <FormError>{error}</FormError>
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

          <FormError>{error}</FormError>

          <div className={styles.actions}>
            <Button variant="ghost" onClick={closeAll} disabled={importing}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={doImport}
              loading={importing}
              loadingText="Importando..."
            >
              Importar {items.length} canciones
            </Button>
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
            <Button variant="ghost" onClick={closeAll}>Cerrar</Button>
            <Button variant="primary" onClick={onGoToPlaylist}>Abrir playlist</Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Wrapper que decide entre BottomSheet (mobile) o Modal (desktop).
 *
 * @param {{ onClose: () => void }} props
 */
export function SpotifyImportDialog({ onClose }) {
  const isMobile = useMobileViewport();
  const useSheet = isMobile && !isDesktop;
  const importing = useImportStore((s) => s.importing);

  /* PWA mobile: empuja el ImportBody al store global. */
  const openSheet = useBottomSheet((s) => s.open);
  const updateSheet = useBottomSheet((s) => s.update);
  const closeSheetById = useBottomSheet((s) => s.closeById);
  const sheetIdRef = useRef(null);

  useEffect(() => {
    if (!useSheet) return;
    const id = openSheet({
      title: 'Importar desde Spotify',
      content: <div className={styles.sheetBody}><ImportBody onClose={onClose} /></div>,
      dismissOnBackdrop: !importing,
      onClose: () => {
        if (!useImportStore.getState().importing) {
          useImportStore.getState().reset();
          onClose();
        }
      },
    });
    sheetIdRef.current = id;
    return () => {
      if (sheetIdRef.current != null) {
        closeSheetById(sheetIdRef.current);
        sheetIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSheet]);

  useEffect(() => {
    if (!useSheet || sheetIdRef.current == null) return;
    updateSheet(sheetIdRef.current, { dismissOnBackdrop: !importing });
  }, [useSheet, importing, updateSheet]);

  if (useSheet) return null;

  /* Desktop: Modal primitive */
  const closeIfNotImporting = () => {
    if (!importing) {
      useImportStore.getState().reset();
      onClose();
    }
  };

  return (
    <Modal
      onClose={closeIfNotImporting}
      title="Importar desde Spotify"
      size="md"
      dismissOnBackdrop={!importing}
      dismissOnEscape={!importing}
    >
      <ImportBody onClose={onClose} />
    </Modal>
  );
}
