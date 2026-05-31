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

export function JamModal({ onClose, initialCode = '' }) {
  const mode = useJamStore((s) => s.mode);
  const session = useJamStore((s) => s.session);
  const participants = useJamStore((s) => s.participants);
  const createSession = useJamStore((s) => s.createSession);
  const joinSession = useJamStore((s) => s.joinSession);
  const leaveSession = useJamStore((s) => s.leaveSession);
  const transferHost = useJamStore((s) => s.transferHost);

  const [view, setView] = useState(initialCode ? 'join' : 'menu');
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Si ya hay sesion activa al abrir el modal, ir directo al estado correspondiente.
  // initialCode (deep-link) tiene prioridad solo cuando estamos idle.
  useEffect(() => {
    if (mode === 'hosting') setView('create');
    else if (mode === 'guest') setView('guest');
    else setView(initialCode ? 'join' : 'menu');
  }, [mode, initialCode]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      await createSession();
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
          return (
            <li key={p.user_id} className={styles.partItem}>
              <span className={styles.partAvatar} aria-hidden="true">
                <Icon name={isHost ? 'Crown' : 'User'} size={14} />
              </span>
              <span className={styles.partId}>
                {p.user_id.slice(0, 8)}
              </span>
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
      {view === 'menu' && (
        <div className={styles.menu}>
          <div className={styles.hero} aria-hidden="true">
            <span className={styles.heroIcon}>
              <Icon name="Radio" size={26} />
            </span>
          </div>
          <p className={styles.intro}>
            Escucha música con tus amigos en tiempo real. El host controla
            la reproducción; los demás siguen sincronizados.
          </p>
          <div className={styles.menuActions}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconLeft="Plus"
              onClick={handleCreate}
              loading={busy}
              loadingText="Creando jam…"
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
            El host controla la reproducción.
          </p>
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
