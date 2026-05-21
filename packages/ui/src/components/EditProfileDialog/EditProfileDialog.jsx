/**
 * EditProfileDialog — modal para editar el perfil social del usuario.
 *
 * Permite cambiar:
 *   - Avatar (foto de perfil) — sube al bucket 'avatars' de Storage.
 *   - Username (@handle, unico) — 3-24 chars, [a-z0-9_].
 *   - Nombre para mostrar (display_name) — visible para amigos.
 *   - Bio (max 200 chars).
 *
 * El username se valida en cliente Y server. Si esta tomado, el insert
 * en Supabase falla con codigo 23505 (unique violation) y mostramos el
 * mensaje correspondiente. El cliente debouncea la verificacion de
 * disponibilidad para mejor UX.
 *
 * @module @ritmiq/ui/components/EditProfileDialog/EditProfileDialog
 */

import { useState, useRef, useEffect } from 'react';
import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { useSocialStore } from '../../stores/social.js';
import { supabase } from '../../lib/supabase.js';
import styles from './EditProfileDialog.module.css';

const USERNAME_RE = /^[a-z0-9_]+$/;

export function EditProfileDialog({ onClose }) {
  const profile       = useSocialStore((s) => s.profile);
  const updateProfile = useSocialStore((s) => s.updateProfile);
  const uploadAvatar  = useSocialStore((s) => s.uploadAvatar);
  const removeAvatar  = useSocialStore((s) => s.removeAvatar);

  // Estado del formulario (inicializado desde el perfil actual)
  const [username,    setUsername]    = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio,         setBio]         = useState(profile?.bio ?? '');
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatarUrl ?? null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);

  const [usernameStatus, setUsernameStatus] = useState('idle');  // idle|checking|available|taken|invalid
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const fileInputRef = useRef(null);
  const debounceRef  = useRef(null);

  // ── Validacion live del username ─────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const next = username.trim().toLowerCase();

    if (next === (profile?.username ?? '')) { setUsernameStatus('idle'); return; }
    if (next.length < 3 || next.length > 24) { setUsernameStatus('invalid'); return; }
    if (!USERNAME_RE.test(next)) { setUsernameStatus('invalid'); return; }

    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('username', next)
        .maybeSingle();
      setUsernameStatus(data ? 'taken' : 'available');
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [username, profile?.username]);

  // ── Avatar: seleccion local + preview ────────────────────────────
  function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('La imagen no debe superar 2 MB.'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Formato no soportado. Usa JPG, PNG o WebP.');
      return;
    }
    setError(null);
    setPendingAvatarFile(file);
    // Preview local sin esperar el upload
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleRemoveAvatar() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await removeAvatar();
      setAvatarPreview(null);
      setPendingAvatarFile(null);
    } catch (e) {
      setError(e?.message ?? 'Error al eliminar el avatar.');
    } finally {
      setSaving(false);
    }
  }

  // ── Submit ───────────────────────────────────────────────────────
  async function handleSave() {
    if (saving) return;
    if (usernameStatus === 'taken' || usernameStatus === 'invalid' || usernameStatus === 'checking') {
      setError('Resuelve los errores antes de guardar.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      // 1) Si hay archivo pendiente, subirlo primero
      if (pendingAvatarFile) {
        await uploadAvatar(pendingAvatarFile);
        setPendingAvatarFile(null);
      }

      // 2) Actualizar campos del perfil
      const patch = {};
      const nextUsername = username.trim().toLowerCase();
      if (nextUsername !== (profile?.username ?? '')) patch.username = nextUsername;
      if (displayName.trim() !== (profile?.displayName ?? '')) {
        patch.displayName = displayName.trim() || null;
      }
      if (bio.trim() !== (profile?.bio ?? '')) {
        patch.bio = bio.trim() || null;
      }

      if (Object.keys(patch).length > 0) {
        const err = await updateProfile(patch);
        if (err) {
          // Codigo 23505 = unique violation (username tomado entre el check y el save)
          if (err.code === '23505') {
            setUsernameStatus('taken');
            throw new Error('Ese @usuario ya esta tomado.');
          }
          throw err;
        }
      }

      onClose();
    } catch (e) {
      setError(e?.message ?? 'Error al guardar el perfil.');
    } finally {
      setSaving(false);
    }
  }

  const usernameHint = (() => {
    if (usernameStatus === 'invalid')   return { tone: 'err',  msg: '3-24 caracteres, solo letras minusculas, numeros y _' };
    if (usernameStatus === 'checking')  return { tone: 'info', msg: 'Verificando...' };
    if (usernameStatus === 'taken')     return { tone: 'err',  msg: 'Ese @usuario ya esta tomado' };
    if (usernameStatus === 'available') return { tone: 'ok',   msg: 'Disponible' };
    return null;
  })();

  return (
    <Modal onClose={onClose} title="Editar perfil" size="md">
      {/* Avatar */}
      <div className={styles.avatarSection}>
        <div className={styles.avatarWrap}>
          {avatarPreview ? (
            <img src={avatarPreview} alt="" className={styles.avatarImg} />
          ) : (
            <div className={styles.avatarPlaceholder}>
              {(displayName || username || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <button
            type="button"
            className={styles.avatarEditBtn}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Cambiar foto de perfil"
          >
            <Icon name="Pencil" size={14} />
          </button>
        </div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          ref={fileInputRef}
          onChange={handleAvatarPick}
          style={{ display: 'none' }}
        />
        <div className={styles.avatarActions}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => fileInputRef.current?.click()}
          >
            Subir foto
          </button>
          {avatarPreview && (
            <button
              type="button"
              className={styles.linkBtnDanger}
              onClick={handleRemoveAvatar}
              disabled={saving}
            >
              Eliminar
            </button>
          )}
        </div>
      </div>

      {/* Username */}
      <div className={styles.field}>
        <label htmlFor="ep-username" className={styles.label}>Nombre de usuario</label>
        <div className={styles.inputWrap}>
          <span className={styles.prefix}>@</span>
          <input
            id="ep-username"
            type="text"
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            placeholder="tunombre"
          />
          {usernameStatus === 'available' && (
            <Icon name="CheckCircle2" size={16} className={styles.inputIconOk} />
          )}
        </div>
        {usernameHint && (
          <p className={styles.hint} data-tone={usernameHint.tone}>{usernameHint.msg}</p>
        )}
      </div>

      {/* Display name */}
      <div className={styles.field}>
        <label htmlFor="ep-display" className={styles.label}>Nombre para mostrar</label>
        <input
          id="ep-display"
          type="text"
          className={styles.input}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          placeholder="Como quieres que te llamen"
        />
        <p className={styles.hintNeutral}>
          Es el nombre que veran tus amigos y aparecera en tu perfil.
        </p>
      </div>

      {/* Bio */}
      <div className={styles.field}>
        <label htmlFor="ep-bio" className={styles.label}>Bio</label>
        <textarea
          id="ep-bio"
          className={styles.textarea}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Cuentale al mundo tu vibra musical"
        />
        <p className={styles.hintNeutral}>{bio.length}/200</p>
      </div>

      {error && <p className={styles.errorMsg}>{error}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnCancel}
          onClick={onClose}
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="button"
          className={styles.btnSave}
          onClick={handleSave}
          disabled={saving || usernameStatus === 'invalid' || usernameStatus === 'taken' || usernameStatus === 'checking'}
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}
