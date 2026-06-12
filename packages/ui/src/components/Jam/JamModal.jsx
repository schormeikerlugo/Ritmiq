/**
 * JamModal — UI para crear/unirse a un Jam (Fase 8.2).
 *
 * Vistas:
 *   - 'menu':    elige entre Crear o Unirse.
 *   - 'create':  estado "hosting", muestra codigo + participantes.
 *   - 'join':    input de codigo + boton.
 *   - 'guest':   estado "guest", muestra info de la sesion + host.
 *
 * El modal NO se cierra automaticamente cuando el user esta en una
 * sesion activa; el user debe explicitamente salir o ocultarlo.
 *
 * @module @ritmiq/ui/components/Jam/JamModal
 */
import { useEffect, useState } from 'react';
import { useJamStore } from '../../stores/jam.js';
import { Modal } from '../Modal/Modal.jsx';
import { Button } from '../primitives/Button.jsx';
import { TextField } from '../primitives/TextField.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { toast } from '../../stores/toast.js';
import { copyToClipboard } from '../../lib/share.js';
import styles from './JamModal.module.css';

/** Construye la URL de invitacion deep-link para un codigo de jam. */
function buildJamLink(code) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ritmiq.app';
  return `${origin}/jam/${code}`;
}

/**
 * Mini-wizard educativo del Jam. Se muestra la PRIMERA vez que el user
 * abre el modal (gate localStorage, por dispositivo, igual que el
 * Onboarding general). Tras verlo se puede re-abrir con el boton "Como
 * funciona" del menu. No interrumpe sesiones activas ni joins por
 * deep-link (el invitado con prisa va directo a 'join').
 */
// v2: la intro pasó de 3 a 4 pasos (añade modos sync/altavoz, cola, invitar).
// Bumpear el key hace que quienes ya vieron la v1 vean la nueva una vez.
const LS_JAM_INTRO = 'ritmiq.jam-intro-seen.v2';
const LS_JAM_INTRO_V1 = 'ritmiq.jam-intro-seen';

function hasSeenJamIntro() {
  if (typeof localStorage === 'undefined') return true;
  try { return localStorage.getItem(LS_JAM_INTRO) === '1'; } catch { return true; }
}
function markJamIntroSeen() {
  try {
    localStorage.setItem(LS_JAM_INTRO, '1');
    localStorage.removeItem(LS_JAM_INTRO_V1); // limpieza del flag viejo
  } catch {}
}

const JAM_INTRO_STEPS = [
  {
    icon: 'Radio',
    title: 'Escuchen juntos, en tiempo real',
    body: 'Crea una sala y comparte el código de 6 caracteres (o invita a un amigo directo). Todos siguen lo que suena, sincronizados al instante.',
  },
  {
    icon: 'Volume2',
    title: 'Dos modos: Sincronizado o Altavoz',
    body: 'Sincronizado: cada quien escucha en su propio dispositivo, a la vez. Altavoz: solo un dispositivo suena (la bocina) y los demás lo controlan a distancia.',
    accent: true,
  },
  {
    icon: 'ListMusic',
    title: 'Una cola para todos',
    body: 'Cualquiera sugiere canciones a la cola compartida con “Sugerir a la jam”. Cada propuesta muestra quién la pidió y suenan en orden, una tras otra.',
    accent: true,
  },
  {
    icon: 'UserPlus',
    title: 'Invita y controla',
    body: 'Invita amigos desde la sección Amigos: les llega una notificación para unirse. El host lleva la reproducción y puede pasarle el control a quien quiera.',
    accent: true,
  },
];

export function JamModal({ onClose, initialCode = '' }) {
  const mode = useJamStore((s) => s.mode);
  const session = useJamStore((s) => s.session);
  const participants = useJamStore((s) => s.participants);
  const createSession = useJamStore((s) => s.createSession);
  const joinSession = useJamStore((s) => s.joinSession);
  const leaveSession = useJamStore((s) => s.leaveSession);
  const transferHost = useJamStore((s) => s.transferHost);
  const readyByUser = useJamStore((s) => s.readyByUser);
  const waitingFor = useJamStore((s) => s.waitingFor);
  const forceStart = useJamStore((s) => s.forceStart);
  const kind = useJamStore((s) => s.kind);
  const jamPlayState = useJamStore((s) => s.state);
  const requestControl = useJamStore((s) => s.requestControl);

  // Estado inicial: si hay sesion activa lo decide el effect de mode; si
  // estamos idle, la intro educativa tiene prioridad la primera vez
  // (salvo que venga un initialCode de deep-link: el invitado quiere
  // unirse ya, no estorbamos).
  const idleStart = initialCode ? 'join' : (hasSeenJamIntro() ? 'menu' : 'intro');
  const [view, setView] = useState(idleStart);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [introStep, setIntroStep] = useState(0);

  // Si ya hay sesion activa al abrir el modal, ir directo al estado correspondiente.
  // initialCode (deep-link) tiene prioridad solo cuando estamos idle.
  useEffect(() => {
    if (mode === 'hosting') setView('create');
    else if (mode === 'guest') setView('guest');
    else setView(initialCode ? 'join' : (hasSeenJamIntro() ? 'menu' : 'intro'));
  }, [mode, initialCode]);

  // Avanza la intro o, en el ultimo paso, la marca como vista y cae al menu.
  const handleIntroNext = () => {
    if (introStep >= JAM_INTRO_STEPS.length - 1) {
      markJamIntroSeen();
      setIntroStep(0);
      setView('menu');
    } else {
      setIntroStep((s) => s + 1);
    }
  };
  const handleIntroSkip = () => {
    markJamIntroSeen();
    setIntroStep(0);
    setView('menu');
  };
  const handleShowIntro = () => {
    setIntroStep(0);
    setView('intro');
  };

  const handleCreate = async (jamKind = 'sync') => {
    setBusy(true);
    setError(null);
    try {
      await createSession(jamKind);
      setView('create');
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    const norm = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(norm)) {
      setError('El codigo tiene 6 caracteres alfanumericos');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await joinSession(norm);
      // El effect de mode cambia la vista a 'create' o 'guest'.
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async () => {
    if (!session?.code) return;
    const ok = await copyToClipboard(session.code);
    if (ok) toast.success('Código copiado');
  };

  // Comparte la invitación: Web Share API nativa (mobile) con fallback a
  // copiar el link deep-link al portapapeles (desktop / sin soporte).
  const handleShareInvite = async () => {
    if (!session?.code) return;
    const url = buildJamLink(session.code);
    const text = `Únete a mi jam en Ritmiq con el código ${session.code}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Jam en Ritmiq', text, url });
        return;
      } catch (e) {
        // El usuario canceló el share nativo: no es error. Solo abortamos
        // si fue AbortError; si fue otra cosa, caemos al fallback.
        if (e?.name === 'AbortError') return;
      }
    }
    const ok = await copyToClipboard(url);
    if (ok) toast.success('Enlace de invitación copiado');
  };

  const handleLeave = async () => {
    setBusy(true);
    try {
      await leaveSession();
      setView('menu');
      setCode('');
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const handleTransfer = async (userId) => {
    setError(null);
    try {
      await transferHost(userId);
      toast.success('Control transferido');
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };

  // Lista de participantes reutilizable. Muestra badge de host (por role)
  // y, si el viewer es host, un boton para pasar el control a cada guest.
  const renderParticipants = (canTransfer) => (
    <div className={styles.participants}>
      <h3 className={styles.partTitle}>
        <Icon name="Users" size={14} />
        Participantes
        <span className={styles.partCount}>{participants.length}</span>
      </h3>
      <ul className={styles.partList}>
        {participants.map((p) => {
          const isHost = p.role === 'host' || p.user_id === session?.hostId;
          const ready = readyByUser?.[p.user_id];
          return (
            <li key={p.user_id} className={styles.partItem}>
              <span className={styles.partAvatar} aria-hidden="true">
                <Icon name={isHost ? 'Crown' : 'User'} size={14} />
              </span>
              <span className={styles.partId}>
                {p.user_id.slice(0, 8)}
              </span>
              {ready === 'loading' && (
                <span className={styles.partLoading} title="Cargando…" aria-label="Cargando">
                  <Icon name="Loader" size={13} />
                </span>
              )}
              {ready === 'ready' && (
                <span className={styles.partReady} title="Listo" aria-label="Listo">
                  <Icon name="Check" size={13} />
                </span>
              )}
              {isHost && <span className={styles.partBadge}>Host</span>}
              {canTransfer && !isHost && (
                <button
                  type="button"
                  className={styles.transferBtn}
                  onClick={() => handleTransfer(p.user_id)}
                  aria-label="Pasar el control a este participante"
                >
                  Pasar control
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <Modal onClose={onClose} title="Jam" size="md">
      {view === 'intro' && (() => {
        const cur = JAM_INTRO_STEPS[introStep];
        const isLast = introStep === JAM_INTRO_STEPS.length - 1;
        return (
          <div className={styles.introWizard}>
            <button
              type="button"
              className={styles.introSkip}
              onClick={handleIntroSkip}
            >
              Saltar
            </button>

            <div className={styles.introIconWrap}>
              <div className={styles.introIconCircle} data-accent={!!cur.accent}>
                <Icon name={cur.icon} size={34} />
              </div>
            </div>

            <h3 className={styles.introTitle}>{cur.title}</h3>
            <p className={styles.introBody}>{cur.body}</p>

            <div className={styles.introDots} aria-hidden="true">
              {JAM_INTRO_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={styles.introDot}
                  data-active={i === introStep}
                />
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleIntroNext}
              iconRight={isLast ? undefined : 'ChevronRight'}
            >
              {isLast ? 'Entendido' : 'Continuar'}
            </Button>
          </div>
        );
      })()}

      {view === 'menu' && (
        <div className={styles.menu}>
          <div className={styles.hero} aria-hidden="true">
            <span className={styles.heroIcon}>
              <Icon name="Radio" size={26} />
            </span>
          </div>
          <p className={styles.intro}>
            Escucha música con tus amigos en tiempo real. Elige el modo,
            comparte una cola y controlen juntos.
          </p>
          <div className={styles.menuActions}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconLeft="Plus"
              onClick={() => setView('kind')}
            >
              Iniciar jam
            </Button>
            <Button
              variant="subtle"
              size="lg"
              fullWidth
              iconLeft="Users"
              onClick={() => setView('join')}
            >
              Unirse a una jam
            </Button>
          </div>
          <button
            type="button"
            className={styles.introLink}
            onClick={handleShowIntro}
          >
            ¿Cómo funciona una jam?
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}

      {view === 'kind' && (
        <div className={styles.kindView}>
          <p className={styles.intro}>¿Qué tipo de jam quieres armar?</p>
          <div className={styles.kindCards}>
            <button
              type="button"
              className={styles.kindCard}
              onClick={() => handleCreate('sync')}
              disabled={busy}
            >
              <span className={styles.kindIcon}><Icon name="Radio" size={24} /></span>
              <span className={styles.kindTitle}>Sincronizado</span>
              <span className={styles.kindDesc}>
                Cada quien escucha en su propio dispositivo, a la vez.
              </span>
            </button>
            <button
              type="button"
              className={styles.kindCard}
              onClick={() => handleCreate('speaker')}
              disabled={busy}
            >
              <span className={styles.kindIcon}><Icon name="Volume2" size={24} /></span>
              <span className={styles.kindTitle}>Altavoz</span>
              <span className={styles.kindDesc}>
                Solo este dispositivo suena; los demás controlan y sugieren.
              </span>
            </button>
          </div>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setView('menu')} disabled={busy}>
              Volver
            </Button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}

      {view === 'join' && (
        <div className={styles.join}>
          <p className={styles.intro}>
            Ingresa el código de 6 caracteres que tu amigo comparte.
          </p>
          <TextField
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            autoFocus
            className={styles.codeInput}
            inputMode="text"
            autoCapitalize="characters"
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setView('menu')}>
              Volver
            </Button>
            <Button
              variant="primary"
              iconLeft="LogIn"
              onClick={handleJoin}
              loading={busy}
              loadingText="Uniéndose…"
              disabled={code.length !== 6}
            >
              Unirse
            </Button>
          </div>
        </div>
      )}

      {view === 'create' && session && (
        <div className={styles.create}>
          <span className={styles.kindBadge}>
            <Icon name={kind === 'speaker' ? 'Volume2' : 'Radio'} size={12} />
            {kind === 'speaker' ? 'Altavoz' : 'Sincronizado'}
          </span>
          <p className={styles.intro}>
            Comparte este código con tus amigos para que se unan:
          </p>
          <button
            type="button"
            className={styles.codeDisplay}
            onClick={handleCopyCode}
            aria-label="Copiar código"
            title="Copiar código"
          >
            <span className={styles.codeText}>{session.code}</span>
            <span className={styles.codeCopyHint}>
              <Icon name="Copy" size={14} /> Copiar
            </span>
          </button>

          <Button
            variant="subtle"
            fullWidth
            iconLeft="Share2"
            onClick={handleShareInvite}
            className={styles.shareBtn}
          >
            Compartir invitación
          </Button>

          {waitingFor.length > 0 && (
            <div className={styles.waitBar}>
              <span className={styles.waitText}>
                <Icon name="Loader" size={14} />
                Esperando a {waitingFor.length} {waitingFor.length === 1 ? 'persona' : 'personas'}…
              </span>
              <button
                type="button"
                className={styles.waitForce}
                onClick={() => forceStart()}
              >
                Reproducir igualmente
              </button>
            </div>
          )}

          {renderParticipants(true)}

          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <Button variant="danger" iconLeft="X" onClick={handleLeave} loading={busy}>
              Cerrar jam
            </Button>
          </div>
        </div>
      )}

      {view === 'guest' && session && (
        <div className={styles.guest}>
          <p className={styles.intro}>
            Estás en una jam con código <strong>{session.code}</strong>.
            {kind === 'speaker'
              ? ' Suena en el dispositivo del host; tú controlas a distancia.'
              : ' El host controla la reproducción.'}
          </p>

          {kind === 'speaker' && (
            <div className={styles.remote}>
              <span className={styles.remoteBadge}>
                <Icon name="Volume2" size={13} /> Reproduciéndose en el altavoz
              </span>
              <div className={styles.remoteNow}>
                <div className={styles.remoteCover}>
                  {jamPlayState?.currentTrack?.coverUrl
                    ? <img src={jamPlayState.currentTrack.coverUrl} alt="" loading="lazy" />
                    : <Icon name="Music" size={22} />}
                </div>
                <div className={styles.remoteMeta}>
                  <span className={styles.remoteTitle}>
                    {jamPlayState?.currentTrack?.title ?? 'Nada sonando'}
                  </span>
                  <span className={styles.remoteArtist}>
                    {jamPlayState?.currentTrack?.artist ?? '—'}
                  </span>
                </div>
              </div>
              <div className={styles.remoteControls}>
                <button
                  className={styles.remoteBtn}
                  onClick={() => requestControl('prev')}
                  aria-label="Anterior"
                ><Icon name="SkipBack" size={22} filled /></button>
                <button
                  className={styles.remotePlay}
                  onClick={() => requestControl(jamPlayState?.isPlaying ? 'pause' : 'play')}
                  aria-label={jamPlayState?.isPlaying ? 'Pausar' : 'Reproducir'}
                ><Icon name={jamPlayState?.isPlaying ? 'Pause' : 'Play'} size={22} filled /></button>
                <button
                  className={styles.remoteBtn}
                  onClick={() => requestControl('next')}
                  aria-label="Siguiente"
                ><Icon name="SkipForward" size={22} filled /></button>
              </div>
            </div>
          )}

          {renderParticipants(false)}
          <div className={styles.actions}>
            <Button variant="danger" iconLeft="LogOut" onClick={handleLeave} loading={busy}>
              Salir de la jam
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
