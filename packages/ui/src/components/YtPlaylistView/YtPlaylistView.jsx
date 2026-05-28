/**
 * Vista de playlist publica de YouTube (resultado de SearchView).
 *
 * Estructura:
 *   ┌────────────────────────────────────────────────────┐
 *   │ Header con gradient + cover grande                  │
 *   │   Titulo + autor + N tracks                         │
 *   │   [▶ Reproducir]  [+ Guardar como playlist]         │
 *   ├────────────────────────────────────────────────────┤
 *   │ Tracks (lista vertical, reproducible)               │
 *   └────────────────────────────────────────────────────┘
 *
 * Click en track → reproduce + carga toda la lista como cola.
 * Click en "Guardar" → crea playlist en biblioteca con todos los tracks
 *   (reusa el mismo flow que albums via libraryAddFromMeta + addTrack).
 */
import { useEffect, useState } from 'react';
import { useYtPlaylistStore } from '../../stores/yt-playlist.js';
import { usePlayerStore } from '../../stores/player.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useLibraryStore } from '../../stores/library.js';
import { useAuthStore } from '../../stores/auth.js';
import { Icon } from '../Icon/Icon.jsx';
import { ConfirmDialog, ErrorState } from '../primitives/index.js';
import { HeroSkeleton, TrackRowSkeleton } from '../Skeleton/index.js';
import { toast } from '../../stores/toast.js';
import { api, isDesktop } from '../../lib/api.js';
import { pushTrack } from '../../lib/sync.js';
import { tryOrQueue } from '../../lib/sync-queue.js';
import styles from './YtPlaylistView.module.css';

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** Convierte un track del payload yt-playlist-resolve en Track-like reproducible. */
function ytTrackToTrack(t) {
  return {
    id: `yt:${t.ytId}`,
    userId: '',
    source: 'youtube',
    ytId: t.ytId,
    title: t.title,
    artist: t.artist ?? null,
    album: null,
    durationSeconds: t.duration ?? null,
    coverUrl: t.thumbnail ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
  };
}

export function YtPlaylistView({ id }) {
  const fetchPl  = useYtPlaylistStore((s) => s.fetch);
  const entry    = useYtPlaylistStore((s) => s.entries[id]);
  const playNow  = usePlayerStore((s) => s.playNow);
  const userId   = useAuthStore((s) => s.user?.id);
  const [savingState, setSavingState] = useState({ saving: false, done: 0, total: 0 });
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (id) fetchPl(id);
  }, [id, fetchPl]);

  if (!entry || entry.loading) {
    return (
      <section className={styles.wrap}>
        <HeroSkeleton />
        <TrackRowSkeleton count={6} />
      </section>
    );
  }

  if (entry.error || !entry.tracks || entry.tracks.length === 0) {
    return (
      <section className={styles.wrap}>
        <ErrorState
          title="No pudimos cargar la playlist"
          message={entry.error ?? 'Vuelve a intentarlo en unos segundos.'}
          onRetry={() => fetchPl(id)}
        />
      </section>
    );
  }

  const tracks = entry.tracks.map(ytTrackToTrack);

  const playAll = () => {
    if (tracks.length === 0) return;
    playNow(tracks, 0);
  };

  const handleSave = async () => {
    setConfirmOpen(false);
    if (!userId) {
      toast.error('Inicia sesion para guardar playlists');
      return;
    }
    const total = tracks.length;
    setSavingState({ saving: true, done: 0, total });
    toast.info(`Guardando "${entry.title}"... (0 / ${total})`, {
      duration: 0,
      icon: 'ListMusic',
    });

    try {
      // 1. Crear playlist con el titulo + author como sufijo.
      const plName = entry.author ? `${entry.title} – ${entry.author}` : entry.title;
      const playlist = await usePlaylistsStore.getState().create(plName);

      // 2. Iterar tracks en serie: libraryAddFromMeta + addTrack. Mismo
      //    patron que useArtistStore.saveAlbumAsPlaylist.
      let done = 0;
      let failed = 0;
      for (const t of entry.tracks) {
        if (!t?.ytId) { failed++; done++; continue; }
        try {
          const persisted = await api.libraryAddFromMeta({
            meta: {
              id: t.ytId,
              title: t.title,
              artist: t.artist ?? entry.author ?? null,
              album: null,
              duration: t.duration ?? null,
              thumbnail: t.thumbnail ?? null,
              uploader: t.artist ?? entry.author ?? null,
            },
            userId,
          });
          // Desktop: sync a Supabase antes de addTrack para evitar FK error.
          if (isDesktop) {
            await tryOrQueue(
              () => pushTrack(persisted),
              { kind: 'track.upsert', payload: persisted },
            );
          }
          await usePlaylistsStore.getState().addTrack(playlist.id, persisted.id);
        } catch (err) {
          console.warn('[yt-playlist] track save failed', t?.title, err?.message);
          failed++;
        }
        done++;
        setSavingState({ saving: true, done, total });
      }

      // Cover de la playlist.
      if (entry.coverUrl) {
        try { await usePlaylistsStore.getState().setCover(playlist.id, entry.coverUrl); } catch {}
      }
      // Refrescar biblioteca.
      try { await useLibraryStore.getState().load(); } catch {}

      setSavingState({ saving: false, done, total });
      if (failed === 0) {
        toast.success(`Guardada como playlist (${done} tracks)`, { icon: 'Check' });
      } else {
        toast.error(`${done - failed}/${total} tracks guardados. ${failed} fallaron.`, {
          duration: 6000,
        });
      }
    } catch (err) {
      setSavingState({ saving: false, done: 0, total: 0 });
      toast.error(`Error guardando playlist: ${err?.message ?? err}`);
    }
  };

  return (
    <section className={styles.wrap}>
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header
        className={styles.header}
        style={entry.coverUrl ? {
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.4) 30%, rgba(0,0,0,0.85)), url(${entry.coverUrl})`,
        } : undefined}
      >
        <div className={styles.headerInner}>
          <div className={styles.kind}>Playlist · YouTube</div>
          <h1 className={styles.name}>{entry.title}</h1>
          {entry.author && (
            <p className={styles.author}>{entry.author}</p>
          )}
          <p className={styles.count}>{tracks.length} canciones</p>
        </div>
      </header>

      {/* ─── Actions ────────────────────────────────────────────────── */}
      <div className={styles.actions}>
        <button
          className={styles.playBtn}
          onClick={playAll}
          disabled={tracks.length === 0}
        >
          <Icon name="Play" size={18} filled />
          <span>Reproducir</span>
        </button>
        <button
          className={styles.secondaryBtn}
          onClick={() => setConfirmOpen(true)}
          disabled={savingState.saving}
        >
          <Icon name={savingState.saving ? 'Loader' : 'Plus'} size={16} />
          <span>
            {savingState.saving
              ? `Guardando ${savingState.done}/${savingState.total}`
              : 'Guardar en biblioteca'}
          </span>
        </button>
      </div>

      {/* ─── Tracks ─────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <ol className={styles.trackList}>
          {tracks.map((t, i) => (
            <li key={`${t.ytId}-${i}`}>
              <button className={styles.trackRow} onClick={() => playNow(tracks, i)}>
                <span className={styles.trackIdx}>{i + 1}</span>
                <div className={styles.trackCover}>
                  {t.coverUrl
                    ? <img src={t.coverUrl} alt="" loading="lazy" />
                    : <Icon name="Music" size={16} />}
                  <span className={styles.trackPlay} aria-hidden="true">
                    <Icon name="Play" size={14} filled />
                  </span>
                </div>
                <div className={styles.trackMeta}>
                  <span className={styles.trackTitle}>{t.title}</span>
                  {t.artist && <span className={styles.trackArtist}>{t.artist}</span>}
                </div>
                {t.durationSeconds ? (
                  <span className={styles.trackDur}>{fmtDur(t.durationSeconds)}</span>
                ) : <span />}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {confirmOpen && (
        <ConfirmDialog
          title={`Guardar "${entry.title}" en tu biblioteca`}
          icon="ListMusic"
          confirmLabel={`Guardar ${tracks.length} canciones`}
          cancelLabel="Cancelar"
          variant="primary"
          body={
            <>
              <p>
                Se creara una playlist en tu biblioteca con las {tracks.length}{' '}
                canciones de esta playlist de YouTube. Los tracks se guardan
                como referencias a YouTube (no se descargan automaticamente).
              </p>
            </>
          }
          onConfirm={handleSave}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}
