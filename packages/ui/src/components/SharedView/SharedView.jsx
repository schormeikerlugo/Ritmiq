/**
 * Landing publica de un track compartido — accesible sin login.
 *
 * Se monta cuando la URL tiene `/share/track/<ytId>` o el formato legacy
 * `?share=track:...`. Muestra cover/titulo/artista + un set de CTAs que
 * cambia segun el contexto detectado:
 *
 *   - PWA standalone (display-mode standalone):
 *       NO se renderiza este componente — App.jsx hace bypass directo
 *       al player. Lo dejamos como guard defensivo igualmente.
 *
 *   - iOS Safari + flag de PWA previamente instalada:
 *       Banner naranja "Tienes Ritmiq instalado" con instruccion clara:
 *       "Mantén pulsado el enlace y toca 'Abrir en Ritmiq'". Incluye
 *       boton para copiar el link y abrirlo manualmente desde otra app.
 *
 *   - iOS Safari sin PWA:
 *       Banner CTA "Instala Ritmiq" con tutorial de Add to Home Screen.
 *
 *   - Android Chrome + manifest correcto:
 *       Chrome captura links automaticamente si la PWA esta instalada.
 *       Si llegan aqui, asumimos que NO la tienen — mostramos CTA de
 *       instalar (Chrome offrira el prompt nativo).
 *
 *   - Desktop:
 *       Solo el CTA "Reproducir en Ritmiq" (la PWA desktop o el
 *       Electron). Sin banners de instalacion intrusivos.
 *
 * @module @ritmiq/ui/components/SharedView
 */
import { useEffect, useState } from 'react';
import logotipoUrl from '../../assets/logotipo.png';
import { Icon } from '../Icon/Icon.jsx';
import {
  isStandalonePWA, hasPwaInstalledFlag, detectPlatform,
  copyToClipboard, buildShareLink,
} from '../../lib/share.js';
import styles from './SharedView.module.css';

/**
 * @param {{
 *   share: { type:'track', ytId:string, title:string|null, artist:string|null, coverUrl:string|null },
 *   onOpenInApp: () => void,
 *   isAuthed: boolean,
 * }} props
 */
export function SharedView({ share, onOpenInApp, isAuthed }) {
  const { ytId, title, artist, coverUrl } = share;
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;
  const [copied, setCopied] = useState(false);

  // Detecciones one-shot al montar.
  const [platform] = useState(() => detectPlatform());
  const [hasInstalled] = useState(() => hasPwaInstalledFlag());
  const [inStandalone] = useState(() => isStandalonePWA());

  // Si por alguna razon esto se renderiza dentro de la PWA standalone,
  // forzamos el onOpenInApp para no atrapar al usuario en la landing.
  useEffect(() => {
    if (inStandalone) onOpenInApp();
  }, [inStandalone, onOpenInApp]);

  const handleCopy = async () => {
    // Re-construye el link canonico actual para que el usuario lo pueda
    // pegar en otra app (Mensajes, Mail) y desde ahi tocar largo el
    // enlace → "Abrir en Ritmiq" funciona en iOS.
    const link = buildShareLink({ ytId, title, artist, coverUrl });
    const url = link || window.location.href;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenInApp = () => {
    if (isAuthed) {
      // Ya logueado en este contexto — App.jsx llevara el track al
      // player. Esto solo deberia ocurrir en Android donde Safari/Chrome
      // y la PWA comparten storage.
      onOpenInApp();
      return;
    }
    // No autenticado aqui: solo podemos sugerir "abre la PWA y vuelve
    // a tocar el link desde alli". Tambien escondemos la landing por
    // si el usuario quiere ver la app aunque no este logueado.
    onOpenInApp();
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.brand}>
        <img src={logotipoUrl} alt="Ritmiq" className={styles.brandLogo} />
        <span className={styles.brandName}>Ritmiq</span>
      </header>

      <main className={styles.card}>
        <div className={styles.coverWrap}>
          {coverUrl ? (
            <img src={coverUrl} alt="" className={styles.cover} />
          ) : (
            <div className={styles.coverFallback}>
              <Icon name="Music" size={64} />
            </div>
          )}
        </div>

        <div className={styles.info}>
          <span className={styles.eyebrow}>Te compartieron este track</span>
          <h1 className={styles.title} data-selectable="true">
            {title || 'Track sin titulo'}
          </h1>
          {artist && (
            <p className={styles.artist} data-selectable="true">{artist}</p>
          )}
        </div>

        {/* ── Banners de contexto ─────────────────────────────────────── */}
        <PlatformBanner
          platform={platform}
          hasInstalled={hasInstalled}
          onCopy={handleCopy}
          copied={copied}
        />

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={handleOpenInApp}
          >
            <Icon name="Play" size={18} filled />
            <span>{isAuthed ? 'Reproducir en Ritmiq' : 'Abrir Ritmiq'}</span>
          </button>
          <a
            className={styles.secondary}
            href={ytUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="Share2" size={16} />
            <span>Ver en YouTube</span>
          </a>
        </div>
      </main>

      <footer className={styles.foot}>
        <span>Reproducido por Ritmiq</span>
      </footer>
    </div>
  );
}

/**
 * Banner contextual segun plataforma + estado instalada. Renderiza nada
 * en desktop sin PWA detectada (la landing por si sola es suficiente).
 */
function PlatformBanner({ platform, hasInstalled, onCopy, copied }) {
  // iOS con PWA antes instalada en este device — banner naranja con
  // instruccion long-press → "Abrir en Ritmiq".
  if (platform === 'ios' && hasInstalled) {
    return (
      <div className={styles.banner} data-tone="warn">
        <div className={styles.bannerIcon}>
          <Icon name="Info" size={18} />
        </div>
        <div className={styles.bannerBody}>
          <strong>¿Tienes Ritmiq instalado?</strong>
          <p>
            Safari no abre PWAs automaticamente. Para escucharlo en la app:
          </p>
          <ol className={styles.bannerSteps}>
            <li>Copia el link con el boton de abajo.</li>
            <li>Pegalo en Mensajes, Mail o Notas.</li>
            <li>Manten pulsado el link y toca <strong>Abrir en Ritmiq</strong>.</li>
          </ol>
          <button type="button" className={styles.bannerCta} onClick={onCopy}>
            <Icon name={copied ? 'Check' : 'Share2'} size={14} />
            <span>{copied ? 'Link copiado' : 'Copiar link'}</span>
          </button>
        </div>
      </div>
    );
  }

  // iOS sin PWA — invitar a instalar.
  if (platform === 'ios' && !hasInstalled) {
    return (
      <div className={styles.banner} data-tone="info">
        <div className={styles.bannerIcon}>
          <Icon name="ArrowDownToLine" size={18} />
        </div>
        <div className={styles.bannerBody}>
          <strong>Instala Ritmiq en tu iPhone</strong>
          <p>Para escucharlo sin abrir Safari cada vez:</p>
          <ol className={styles.bannerSteps}>
            <li>Toca el boton <strong>Compartir</strong> de Safari (cuadrado con flecha hacia arriba).</li>
            <li>Desplaza hacia abajo y toca <strong>Anadir a inicio</strong>.</li>
            <li>Abre Ritmiq desde el icono nuevo de tu pantalla de inicio.</li>
          </ol>
        </div>
      </div>
    );
  }

  // Android — Chrome suele capturar links si la PWA esta instalada. Si
  // llegamos aqui, asumimos que no la tienen y promovemos instalacion.
  if (platform === 'android') {
    return (
      <div className={styles.banner} data-tone="info">
        <div className={styles.bannerIcon}>
          <Icon name="ArrowDownToLine" size={18} />
        </div>
        <div className={styles.bannerBody}>
          <strong>Instala Ritmiq en tu telefono</strong>
          <p>
            Toca el menu del navegador (3 puntos) y elige{' '}
            <strong>Instalar aplicacion</strong> o <strong>Anadir a pantalla principal</strong>.
            La proxima vez los links se abriran directo en Ritmiq.
          </p>
        </div>
      </div>
    );
  }

  // Desktop — no mostramos banner (la primary action es suficiente).
  return null;
}
