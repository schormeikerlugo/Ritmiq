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
import { enrichArtistTags } from '../../lib/enrich-tags.js';
import { useSocialStore } from '../../stores/social.js';
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
import { HomeStats } from './HomeStats.jsx';
import { playPlaylist } from '../../lib/play-helpers.js';
import { usePullToRefresh } from '../../lib/use-pull-to-refresh.js';
import { PullIndicator } from '../PullToRefresh/PullToRefresh.jsx';
import styles from './Home.module.css';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Capitaliza un tag de Last.fm para display.
 * Last.fm guarda tags en lowercase ("hip-hop", "indie rock"). Para titulos
 * de UI los queremos en Title Case respetando palabras compuestas y siglas.
 *
 * Casos:
 *   "hip-hop"       → "Hip-Hop"
 *   "indie rock"    → "Indie Rock"
 *   "rnb"           → "RnB"      (sigla conocida)
 *   "edm"           → "EDM"
 *   "r&b"           → "R&B"
 */
const TAG_ABBREVIATIONS = new Set(['rnb', 'edm', 'idm', 'r&b', 'iem', 'lofi']);
function capitalizeTag(tag) {
  if (!tag || typeof tag !== 'string') return '';
  const norm = tag.trim().toLowerCase();
  if (!norm) return '';
  if (TAG_ABBREVIATIONS.has(norm)) {
    if (norm === 'rnb' || norm === 'r&b') return 'R&B';
    return norm.toUpperCase();
  }
  // Title case con preservacion de guiones y &.
  return norm.replace(/([a-z])([a-z]*)/g, (_m, first, rest) => first.toUpperCase() + rest);
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

  // Preferimos el nombre social (display_name) > @username > local-part del email.
  // Asi el usuario controla como aparece su nombre en el saludo grande.
  const socialProfile = useSocialStore((s) => s.profile);
  const name = socialProfile?.displayName
            || socialProfile?.username
            || user?.email?.split('@')[0]
            || '';

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

    // Pre-enriquece artist_tags para los top 10 artistas del usuario.
    // Fire-and-forget: la edge function actualiza el cache para que la
    // proxima llamada a auto-genre-mix tenga datos frescos sin esperar
    // a Last.fm. Throttled internamente a 60s entre llamadas (Fase 5.1).
    if (topArtists.length > 0) {
      const names = topArtists.map((a) => a.artist).filter(Boolean).slice(0, 10);
      if (names.length > 0) enrichArtistTags(names);
    }
  }, [topArtistSeed, trackSeed?.ytId, trackSeed?.artist, topArtists.length, fetchRec]);

  const similarArtistRec = topArtistSeed ? recStore[`similar-artist:${topArtistSeed}`] : null;
  const byTrackRec       = trackSeed?.artist && trackSeed?.title
    ? recStore[`mix-by-track:${trackSeed.artist}::${trackSeed.title}`]
    : null;
  const genreRec         = recStore['auto-genre-mix:'];
  const discoverRec      = recStore['discover:'];

  // Pull-to-refresh — refresca historial + recomendaciones de Last.fm.
  // Solo activo en mobile (max-width 768px). El historial vive como
  // tracking client-side; el "refresh" semantico aqui es re-fetch de
  // recomendaciones, que es lo que cambia con frecuencia.
  const refetchRecs = () => {
    const ps = [];
    if (topArtistSeed) ps.push(fetchRec('similar-artist', topArtistSeed));
    if (trackSeed?.artist && trackSeed?.title) {
      ps.push(fetchRec('mix-by-track', `${trackSeed.artist}::${trackSeed.title}`));
    }
    if (topArtists.length >= 1) ps.push(fetchRec('auto-genre-mix', ''));
    if (topArtists.length >= 2) ps.push(fetchRec('discover', ''));
    return Promise.allSettled(ps);
  };
  const { bind: ptrBind, pullDistance, refreshing } = usePullToRefresh({
    onRefresh: refetchRecs,
  });

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
    <section className={styles.wrap} {...ptrBind}>
      <PullIndicator pullDistance={pullDistance} refreshing={refreshing} />
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
                ? <img src={pl.coverUrl} alt="" loading="lazy" />
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

      {/* ─── Tu actividad: horas escuchadas + racha animada ─── */}
      <HomeStats />

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

      {/* ─── Mix por género real (Fase 5.2 — auto-genre-mix + enrich-tags) ─── */}
      {topArtists.length >= 1 && (
        <HomeRow
          title={genreRec?.seed ? `Mix de ${capitalizeTag(genreRec.seed)}` : 'Mix por género'}
          subtitle={
            genreRec?.seed
              ? `Tu género más escuchado: ${capitalizeTag(genreRec.seed)}`
              : 'Calculando tu género dominante…'
          }
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
