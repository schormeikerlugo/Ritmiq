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
import { Button, TextField, FormError } from '../primitives/index.js';
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
      if (pendingAvatarFile) {
        await uploadAvatar(pendingAvatarFile);
        setPendingAvatarFile(null);
      }

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
          if (err.code === '23505') {
            setUsernameStatus('taken');
            throw new Error('Ese @usuario ya esta tomado.');
          }
          if (err.code === 'PGRST116') {
            throw new Error('No tienes permiso para actualizar este perfil.');
          }
          throw new Error(err.message ?? 'No se pudo guardar el perfil.');
        }
      }

      onClose();
    } catch (e) {
      console.error('[edit-profile] save failed', e);
      setError(e?.message ?? 'Error al guardar el perfil.');
    } finally {
      setSaving(false);
    }
  }

  // Mensajes derivados para los TextField (error/success/hint)
  const usernameField = (() => {
    if (usernameStatus === 'invalid')   return { error: '3-24 caracteres, solo a-z, 0-9 y _' };
    if (usernameStatus === 'taken')     return { error: 'Ese @usuario ya está tomado' };
    if (usernameStatus === 'checking')  return { hint: 'Verificando disponibilidad...' };
    if (usernameStatus === 'available') return { success: 'Disponible' };
    return {};
  })();

  const canSave = !saving &&
    usernameStatus !== 'invalid' &&
    usernameStatus !== 'taken' &&
    usernameStatus !== 'checking';

  return (
    <Modal
      onClose={onClose}
      title="Editar perfil"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            loadingText="Guardando..."
            disabled={!canSave}
          >
            Guardar
          </Button>
        </>
      }
    >
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
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
            Subir foto
          </Button>
          {avatarPreview && (
            <Button variant="ghost" size="sm" onClick={handleRemoveAvatar} disabled={saving}>
              Eliminar
            </Button>
          )}
        </div>
      </div>

      <TextField
        label="Nombre de usuario"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
        maxLength={24}
        autoComplete="off"
        spellCheck={false}
        placeholder="tunombre"
        prefix="@"
        error={usernameField.error}
        success={usernameField.success}
        hint={usernameField.hint}
      />

      <TextField
        label="Nombre para mostrar"
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={60}
        placeholder="Como quieres que te llamen"
        hint="Es el nombre que verán tus amigos y aparecerá en tu perfil."
      />

      {/* Bio — textarea, no hay primitive todavia. Mantenemos el patron local. */}
      <div className={styles.bioField}>
        <label htmlFor="ep-bio" className={styles.bioLabel}>Bio</label>
        <textarea
          id="ep-bio"
          className={styles.textarea}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Cuéntale al mundo tu vibra musical"
        />
        <p className={styles.bioCounter}>{bio.length}/200</p>
      </div>

      <FormError onDismiss={() => setError(null)}>{error}</FormError>
    </Modal>
  );
}
