/**
 * Subvista de Cuenta — detalle del usuario + perfil social.
 *
 * Tres bloques principales:
 *   1. Perfil — avatar grande + display name + @handle + bio + boton Editar.
 *   2. Informacion personal — email + id (truncado).
 *   3. Seguridad / Sesion — placeholders + cerrar sesion.
 *
 * El boton Editar abre <EditProfileDialog>, que persiste cambios en
 * la tabla `profiles` de Supabase y actualiza el useSocialStore.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/AccountInfoView
 */
import { useState } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { useSocialStore } from '../../../stores/social.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import { EditProfileDialog } from '../../EditProfileDialog/EditProfileDialog.jsx';
import styles from '../SettingsView.module.css';
import profileStyles from './AccountInfoView.module.css';

/** @param {{ onBack: () => void }} props */
export function AccountInfoView({ onBack }) {
  const user    = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const profile = useSocialStore((s) => s.profile);

  const [editOpen, setEditOpen] = useState(false);

  const displayName = profile?.displayName ?? profile?.username ?? '';
  const initial     = (displayName || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <section className={styles.wrap}>
      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <Icon name="ChevronLeft" size={14} />
          <span>Ajustes</span>
        </button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>Cuenta</h1>
      </header>

      {/* ── Perfil social — bloque hero ─────────────────────────────── */}
      <div className={profileStyles.profileHero}>
        <div className={profileStyles.avatarWrap}>
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className={profileStyles.avatar} />
          ) : (
            <div className={profileStyles.avatarPlaceholder}>{initial}</div>
          )}
        </div>
        <div className={profileStyles.profileInfo}>
          <h2 className={profileStyles.displayName}>
            {displayName || <span className={profileStyles.muted}>Sin nombre</span>}
          </h2>
          {profile?.username && (
            <p className={profileStyles.handle}>@{profile.username}</p>
          )}
          {profile?.bio && <p className={profileStyles.bio}>{profile.bio}</p>}
        </div>
        <button
          type="button"
          className={profileStyles.editBtn}
          onClick={() => setEditOpen(true)}
        >
          <Icon name="Pencil" size={14} />
          <span>Editar perfil</span>
        </button>
      </div>

      <SettingsGroup title="Informacion personal">
        <SettingRow label="Correo electronico" description={user?.email ?? '—'} />
        <SettingRow
          label="ID de usuario"
          description={user?.id ?? '—'}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Seguridad"
        hint="Cambios de contrasena y eliminacion de cuenta proximamente."
      >
        <SettingRow
          label="Cambiar contrasena"
          description="Disponible en una proxima actualizacion."
          control={<LinkButton onClick={() => {}}>Editar</LinkButton>}
        />
      </SettingsGroup>

      <SettingsGroup title="Sesion">
        <button type="button" className={styles.signOut} onClick={signOut}>
          <Icon name="LogOut" size={16} />
          <span>Cerrar sesion</span>
        </button>
      </SettingsGroup>

      {editOpen && <EditProfileDialog onClose={() => setEditOpen(false)} />}
    </section>
  );
}
