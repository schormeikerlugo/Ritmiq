/**
 * Home — pantalla principal estilo Spotify.
 *
 * Estructura:
 *   1. Hero: saludo + tiles compactos de accesos rápidos.
 *   2. Continúa escuchando — tracks empezados pero no terminados (heurística
 *      basada en duration_played_seconds / duration_seconds). En la práctica
 *      cubre también el rol que tenía "Reproducidos recientemente", así que
 *      esta segunda fila se eliminó para evitar duplicación.
 *   3. Tus más escuchados — top tracks últimos 30 días.
 *   4. Tus artistas — top artistas últimos 30 días (cards circulares).
 *   5. Tus playlists — carrusel.
 *   6. Descargados para offline — solo si hay.
 *
 * Click en card → reproduce ese track + carga la fila completa como cola
 * (comportamiento Spotify). Botón "Reproducir todo" inicia desde el primero.
 *
 * Filas con 0 items se ocultan automáticamente (HomeRow retorna null).
 */
import { useEffect, useMemo } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useHistoryStore, selectRecentTracks, selectTopTracks, selectTopArtists, selectContinueListening } from '../../stores/history.js';
import { useRecommendationsStore } from '../../stores/recommendations.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import { HomeRow } from './HomeRow.jsx';
import { TrackCard } from './TrackCard.jsx';
import { ArtistCard } from './ArtistCard.jsx';
import { playPlaylist } from '../../lib/play-helpers.js';
import styles from './Home.module.css';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function Home() {
  const user      = useAuthStore((s) => s.user);
  const tracks    = useLibraryStore((s) => s.tracks);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const events    = useHistoryStore((s) => s.events);
  const playNow   = usePlayerStore((s) => s.playNow);
  const goLibrary = useViewStore((s) => s.goLibrary);
  const goPlaylist = useViewStore((s) => s.goPlaylist);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);

  const name = user?.email?.split('@')[0] ?? '';

  /* ── Derivados del historial ─────────────────────────────────────────── */
  const recent     = useMemo(() => selectRecentTracks(events, 12),       [events]);
  const top        = useMemo(() => selectTopTracks(events, { days: 30, limit: 12 }), [events]);
  const continueLi = useMemo(() => selectContinueListening(events, { limit: 8 }),    [events]);
  const topArtists = useMemo(() => selectTopArtists(events, { days: 30, limit: 10 }), [events]);

  /* ── Tracks descargados ──────────────────────────────────────────────── */
  const downloaded = useMemo(
    () => tracks.filter((t) => t.isDownloaded).slice(0, 12),
    [tracks]
  );

  /* ── Recomendaciones Last.fm (Fase 2) ────────────────────────────────── */
  const recStore = useRecommendationsStore((s) => s.sections);
  const fetchRec = useRecommendationsStore((s) => s.fetch);

  // Seed para "Mix de [Artista]" — el artista #1 del usuario.
  const topArtistSeed = topArtists[0]?.artist ?? null;
  // Seed para "Porque escuchaste X" — el track #1 reproducido recientemente.
  const trackSeed = recent[0] ?? null;

  useEffect(() => {
    if (topArtistSeed) fetchRec('similar-artist', topArtistSeed).catch(() => {});
    if (trackSeed?.artist && trackSeed?.title) {
      fetchRec('mix-by-track', `${trackSeed.artist}::${trackSeed.title}`).catch(() => {});
    }
    // Mix de género automático — el server deriva el tag dominante del
    // historial del usuario vía artist_tags. No necesita seed cliente.
    if (topArtists.length >= 1) fetchRec('auto-genre-mix', '').catch(() => {});
    // Discover solo si tenemos historial suficiente.
    if (topArtists.length >= 2) fetchRec('discover', '').catch(() => {});
  }, [topArtistSeed, trackSeed?.ytId, trackSeed?.artist, topArtists.length, fetchRec]);

  const similarArtistRec = topArtistSeed ? recStore[`similar-artist:${topArtistSeed}`] : null;
  const byTrackRec       = trackSeed?.artist && trackSeed?.title
    ? recStore[`mix-by-track:${trackSeed.artist}::${trackSeed.title}`]
    : null;
  const genreRec         = recStore['auto-genre-mix:'];
  const discoverRec      = recStore['discover:'];

  /* ── Lanzar cola completa empezando en `startIdx` ───────────────────── */
  const playRow = (rowItems, startIdx = 0) => {
    if (!rowItems || rowItems.length === 0) return;
    // Filtrar items sin id reproducible (artists sin seedTrack, p.ej.).
    const playables = rowItems
      .map((it) => it?.id ? it : (it?.seedTrack ?? null))
      .filter(Boolean);
    if (playables.length === 0) return;
    const clampedStart = Math.min(startIdx, playables.length - 1);
    playNow(playables, clampedStart);
  };

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {getGreeting()}{name ? `, ${name}` : ''}
        </h1>
        <p className={styles.subtitle}>
          ¿Qué quieres escuchar hoy?
        </p>
      </header>

      {/* ─── Hero: accesos rápidos ─── */}
      <div className={styles.heroGrid}>
        <button className={styles.heroTile} onClick={goLibrary}>
          <div className={styles.heroIcon} aria-hidden="true"><Icon name="Library" size={20} /></div>
          <span className={styles.heroLabel}>Tu biblioteca</span>
        </button>
        {playlists.slice(0, 5).map((pl) => (
          <button
            key={pl.id}
            className={styles.heroTile}
            onClick={() => goPlaylist(pl.id)}
          >
            <div className={styles.heroIcon} aria-hidden="true">
              {pl.coverUrl
                ? <img src={pl.coverUrl} alt="" />
                : <Icon name={pl.id === favoritesId ? 'Heart' : 'Music'} size={20} filled={pl.id === favoritesId} />}
            </div>
            <span className={styles.heroLabel}>{pl.name}</span>
            <span
              className={styles.heroPlay}
              role="button"
              tabIndex={-1}
              aria-label={`Reproducir ${pl.name}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                playPlaylist(pl.id);
              }}
            >
              <Icon name="Play" size={14} filled />
            </span>
          </button>
        ))}
      </div>

      {/* ─── Continúa escuchando ─── */}
      <HomeRow
        title="Continúa escuchando"
        subtitle="Retoma donde lo dejaste"
        items={continueLi}
        onPlayAll={() => playRow(continueLi)}
        renderItem={(t, i) => (
          <TrackCard track={t} onClick={() => playRow(continueLi, i)} />
        )}
      />

      {/* ─── Tus más escuchados ─── */}
      <HomeRow
        title="Tus más escuchados"
        subtitle="Últimos 30 días"
        items={top}
        onPlayAll={() => playRow(top)}
        renderItem={(t, i) => (
          <TrackCard
            track={t}
            subtitle={`${t.artist ?? ''}${t.playCount ? ` · ${t.playCount} ${t.playCount === 1 ? 'play' : 'plays'}` : ''}`}
            onClick={() => playRow(top, i)}
          />
        )}
      />

      {/* ─── Porque escuchaste [Track] (Fase 2) ─── */}
      {trackSeed?.title && (
        <HomeRow
          title={`Porque escuchaste ${trackSeed.title}`}
          subtitle={`Canciones similares a ${trackSeed.artist ?? ''}`}
          items={byTrackRec?.tracks ?? []}
          loading={byTrackRec?.loading}
          onPlayAll={byTrackRec?.tracks?.length ? () => playRow(byTrackRec.tracks) : undefined}
          renderItem={(t, i) => (
            <TrackCard track={t} onClick={() => playRow(byTrackRec.tracks, i)} />
          )}
        />
      )}

      {/* ─── Mix de [Artista] (Fase 2) ─── */}
      {topArtistSeed && (
        <HomeRow
          title={`Mix de ${topArtistSeed}`}
          subtitle="Artistas similares a los que más escuchas"
          items={similarArtistRec?.tracks ?? []}
          loading={similarArtistRec?.loading}
          onPlayAll={similarArtistRec?.tracks?.length ? () => playRow(similarArtistRec.tracks) : undefined}
          renderItem={(t, i) => (
            <TrackCard
              track={t}
              subtitle={t.artist ?? ''}
              onClick={() => playRow(similarArtistRec.tracks, i)}
            />
          )}
        />
      )}

      {/* ─── Mix por género real (Fase 3 — auto-genre-mix) ─── */}
      {topArtists.length >= 1 && (
        <HomeRow
          title={genreRec?.seed ? `Mix de ${genreRec.seed}` : 'Mix por género'}
          subtitle="Tu género más escuchado"
          items={genreRec?.tracks ?? []}
          loading={genreRec?.loading}
          onPlayAll={genreRec?.tracks?.length ? () => playRow(genreRec.tracks) : undefined}
          renderItem={(t, i) => (
            <TrackCard
              track={t}
              subtitle={t.artist ?? ''}
              onClick={() => playRow(genreRec.tracks, i)}
            />
          )}
        />
      )}

      {/* ─── Para descubrir (Fase 2) ─── */}
      {topArtists.length >= 2 && (
        <HomeRow
          title="Para descubrir"
          subtitle="Artistas nuevos que podrían gustarte"
          items={discoverRec?.tracks ?? []}
          loading={discoverRec?.loading}
          onPlayAll={discoverRec?.tracks?.length ? () => playRow(discoverRec.tracks) : undefined}
          renderItem={(t, i) => (
            <TrackCard
              track={t}
              subtitle={t.artist ?? ''}
              onClick={() => playRow(discoverRec.tracks, i)}
            />
          )}
        />
      )}

      {/* ─── Tus artistas ─── */}
      <HomeRow
        title="Tus artistas"
        subtitle="Los que más escuchas"
        items={topArtists}
        renderItem={(entry, i) => (
          <ArtistCard
            entry={entry}
            onClick={() => {
              // Reproduce el seedTrack del artista; la fila completa también
              // queda como cola (un track por artista del top).
              playRow(topArtists, i);
            }}
          />
        )}
      />

      {/* ─── Descargados offline ─── */}
      <HomeRow
        title="Descargados"
        subtitle="Disponibles sin conexión"
        items={downloaded}
        onPlayAll={() => playRow(downloaded)}
        renderItem={(t, i) => (
          <TrackCard track={t} onClick={() => playRow(downloaded, i)} />
        )}
      />

      {/* ─── Empty state si no hay nada ─── */}
      {recent.length === 0 && top.length === 0 && tracks.length === 0 && (
        <div className={styles.empty}>
          <Icon name="Music" size={32} />
          <div>
            <p className={styles.emptyTitle}>Aún no has escuchado nada</p>
            <p className={styles.emptyText}>
              Busca una canción arriba o importa una playlist de Spotify para empezar.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
