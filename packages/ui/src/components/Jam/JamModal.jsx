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

export function JamModal({ onClose }) {
  const mode = useJamStore((s) => s.mode);
  const session = useJamStore((s) => s.session);
  const participants = useJamStore((s) => s.participants);
  const createSession = useJamStore((s) => s.createSession);
  const joinSession = useJamStore((s) => s.joinSession);
  const leaveSession = useJamStore((s) => s.leaveSession);
  const transferHost = useJamStore((s) => s.transferHost);

  const [view, setView] = useState('menu');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Si ya hay sesion activa al abrir el modal, ir directo al estado correspondiente.
  useEffect(() => {
    if (mode === 'hosting') setView('create');
    else if (mode === 'guest') setView('guest');
    else setView('menu');
  }, [mode]);

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
    if (ok) toast.success('Codigo copiado');
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
        <Icon name="Users" size={14} /> Participantes ({participants.length})
      </h3>
      <ul className={styles.partList}>
        {participants.map((p) => {
          const isHost = p.role === 'host' || p.user_id === session?.hostId;
          return (
            <li key={p.user_id} className={styles.partItem}>
              {isHost && (
                <Icon name="BadgeCheck" size={12} className={styles.hostIcon} />
              )}
              <span className={styles.partId}>
                {p.user_id.slice(0, 8)}…
                {isHost && ' (Host)'}
              </span>
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
          <p className={styles.intro}>
            Escucha musica con tus amigos en tiempo real. El host controla
            la reproduccion; los demas siguen sincronizados.
          </p>
          <div className={styles.menuActions}>
            <Button variant="primary" onClick={handleCreate} loading={busy}>
              <Icon name="Plus" size={16} /> Iniciar jam
            </Button>
            <Button variant="ghost" onClick={() => setView('join')}>
              <Icon name="Users" size={16} /> Unirse a jam
            </Button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}

      {view === 'join' && (
        <div className={styles.join}>
          <p className={styles.intro}>
            Ingresa el codigo de 6 caracteres que tu amigo comparte.
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
            <Button variant="primary" onClick={handleJoin} loading={busy} disabled={code.length !== 6}>
              Unirse
            </Button>
          </div>
        </div>
      )}

      {view === 'create' && session && (
        <div className={styles.create}>
          <p className={styles.intro}>
            Comparte este codigo con tus amigos para que se unan:
          </p>
          <button
            type="button"
            className={styles.codeDisplay}
            onClick={handleCopyCode}
            aria-label="Copiar codigo"
          >
            <span className={styles.codeText}>{session.code}</span>
            <Icon name="Link" size={16} />
          </button>

          {renderParticipants(true)}

          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <Button variant="danger" onClick={handleLeave} loading={busy}>
              Cerrar jam
            </Button>
          </div>
        </div>
      )}

      {view === 'guest' && session && (
        <div className={styles.guest}>
          <p className={styles.intro}>
            Estas en una jam con codigo <strong>{session.code}</strong>.
            El host controla la reproduccion.
          </p>
          {renderParticipants(false)}
          <div className={styles.actions}>
            <Button variant="danger" onClick={handleLeave} loading={busy}>
              Salir de la jam
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
