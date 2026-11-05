/**
 * TV como altavoz: bloque de conexión de la barra inferior (código + quién
 * está conectado) y ventana con el código grande, la lista de participantes
 * (expulsar) y "Cambiar código".
 *
 * Sin QR: en iPhone los enlaces siempre abren Safari, nunca la app de la
 * pantalla de inicio (ni con sesión iniciada), así que el QR no servía. Con la
 * misma cuenta, la app ofrece "Conectar a mi TV" en Jam (stores/jam.js
 * findMySpeakers); el resto escribe el código.
 *
 * Solo se monta en la app de TV (lib/tv-nav.js IS_TV). La sesión la crea
 * lib/tv-speaker.js.
 *
 * @module @ritmiq/ui/components/Jam/TvConnect
 */
import { useEffect, useState } from 'react';
import { useJamStore } from '../../stores/jam.js';
import { toast } from '../../stores/toast.js';
import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import styles from './TvConnect.module.css';

// Conectado = latido (heartbeat cada 30 s) en los últimos 2 minutos. Quien
// cierra la app sin salir deja de contar solo.
const ALIVE_MS = 120_000;
function activeGuests(participants, hostId) {
  const now = Date.now();
  return participants.filter((p) => p.user_id !== hostId
    && (!p.last_seen_at || now - Date.parse(p.last_seen_at) < ALIVE_MS));
}

/** Re-render cada 30 s para que caduquen los conectados sin latido. */
function useTick(ms) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function nameOf(profilesById, userId) {
  const p = profilesById?.[userId];
  return p?.displayName || p?.username || userId.slice(0, 8);
}

function Avatar({ profile, size = 24 }) {
  return profile?.avatarUrl
    ? <img className={styles.avatar} src={profile.avatarUrl} alt="" width={size} height={size} />
    : <span className={styles.avatar} style={{ width: size, height: size }}><Icon name="User" size={Math.round(size * 0.6)} /></span>;
}

export function TvConnectBlock() {
  const session = useJamStore((s) => s.session);
  const mode = useJamStore((s) => s.mode);
  const participants = useJamStore((s) => s.participants);
  const profilesById = useJamStore((s) => s.profilesById);
  const [open, setOpen] = useState(false);
  useTick(30_000);

  if (mode !== 'hosting' || !session?.code) {
    return <span className={styles.block} data-loading="true"><Icon name="Loader2" size={16} /> Preparando…</span>;
  }
  const guests = activeGuests(participants, session.hostId);

  return (
    <>
      <button
        type="button"
        className={styles.block}
        onClick={() => setOpen(true)}
        aria-label={`Conectar teléfono. Código ${session.code}`}
      >
        <span className={styles.blockIcon}><Icon name="Smartphone" size={22} /></span>
        <span className={styles.blockText}>
          <span className={styles.blockLabel}>Controla desde Ritmiq → Jam</span>
          <span className={styles.code}>{session.code}</span>
        </span>
        {guests.length > 0 && (
          <span className={styles.avatars}>
            {guests.slice(0, 3).map((p) => <Avatar key={p.user_id} profile={profilesById[p.user_id]} />)}
            {guests.length > 3 && <span className={styles.more}>+{guests.length - 3}</span>}
          </span>
        )}
      </button>
      {open && <TvConnectDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function TvConnectDialog({ onClose }) {
  const session = useJamStore((s) => s.session);
  const participants = useJamStore((s) => s.participants);
  const profilesById = useJamStore((s) => s.profilesById);
  const kick = useJamStore((s) => s.kickParticipant);
  const rotate = useJamStore((s) => s.rotateCode);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const guests = activeGuests(participants, session.hostId);

  const onKick = async (userId) => {
    try { await kick(userId); toast.success(`${nameOf(profilesById, userId)} desconectado`); }
    catch { toast.error('No se pudo desconectar'); }
  };
  const onRotate = async () => {
    setBusy(true);
    try { await rotate(); toast.success('Código nuevo: el anterior ya no sirve'); }
    catch { toast.error('No se pudo cambiar el código'); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Controla la TV" size="lg">
      <div className={styles.dialog}>
        <div className={styles.info}>
          <p className={styles.bigCode}>{session.code}</p>
          <p className={styles.step}><strong>Con tu cuenta:</strong> en Ritmiq (móvil o PC), abre Jam y pulsa «Conectar a mi TV».</p>
          <p className={styles.step}><strong>Otra persona:</strong> en Ritmiq, Jam → Unirse a una jam, y escribe el código.</p>

          <h3 className={styles.partTitle}>
            Conectados <span className={styles.count}>{guests.length}</span>
          </h3>
          {guests.length === 0 ? (
            <p className={styles.empty}>Nadie conectado todavía.</p>
          ) : (
            <ul className={styles.list}>
              {guests.map((p) => (
                <li key={p.user_id} className={styles.item}>
                  <Avatar profile={profilesById[p.user_id]} size={28} />
                  <span className={styles.name}>{nameOf(profilesById, p.user_id)}</span>
                  <button type="button" className={styles.kick} onClick={() => onKick(p.user_id)}>
                    <Icon name="UserX" size={16} /> Desconectar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onRotate} disabled={busy}>
              <Icon name="RefreshCw" size={16} /> Cambiar código
            </button>
            <button type="button" className={styles.primary} onClick={onClose} data-primary>
              Listo
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
