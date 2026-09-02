/**
 * IOSInstallHint — modal con tutorial visual de "Add to Home Screen".
 *
 * Se muestra cuando el usuario intenta activar notificaciones push
 * desde Safari iOS (no PWA standalone). En esa situacion,
 * Notification.requestPermission() devuelve 'default' silenciosamente
 * \u2014 el API esta disponible pero no funciona. Apple solo expone Push
 * para PWAs instaladas via Compartir > Anadir a pantalla de inicio.
 *
 * Tutorial visual 3 pasos:
 *   1. Pulsa el boton Compartir (icono de cuadrado con flecha hacia
 *      arriba) en la barra inferior de Safari.
 *   2. Desplaza y pulsa "Anadir a pantalla de inicio".
 *   3. Abre Ritmiq desde el icono en tu pantalla principal.
 *
 * Tras instalar, el usuario debe abrir la PWA y volver a Cuenta para
 * activar las notificaciones \u2014 ahora el toggle si funcionara.
 *
 * @module @ritmiq/ui/components/IOSInstallHint/IOSInstallHint
 */
import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { isIOS26OrNewer } from '../../lib/share.js';
import styles from './IOSInstallHint.module.css';

export function IOSInstallHint({ onClose }) {
  // iOS 26+ instala CUALQUIER sitio como web app y muestra un toggle
  // "Abrir como web app" en el diálogo de Añadir. El copy se adapta.
  const ios26 = isIOS26OrNewer();

  return (
    <Modal
      onClose={onClose}
      title="Instala Ritmiq para recibir notificaciones"
      size="md"
    >
      <div className={styles.intro}>
        <p>
          iOS solo permite notificaciones push a las apps instaladas
          en la pantalla de inicio. Es un proceso de 10 segundos:
        </p>
      </div>

      <ol className={styles.steps}>
        <li className={styles.step}>
          <div className={styles.stepIcon} aria-hidden="true">
            <Icon name="Share2" size={26} />
          </div>
          <div className={styles.stepBody}>
            <span className={styles.stepNum}>1</span>
            <h3 className={styles.stepTitle}>Pulsa el botón Compartir</h3>
            <p className={styles.stepDesc}>
              Lo encuentras en la barra inferior de Safari — un
              cuadrado con una flecha hacia arriba.
            </p>
          </div>
        </li>

        <li className={styles.step}>
          <div className={styles.stepIcon} aria-hidden="true">
            <Icon name="Plus" size={26} />
          </div>
          <div className={styles.stepBody}>
            <span className={styles.stepNum}>2</span>
            <h3 className={styles.stepTitle}>"Añadir a pantalla de inicio"</h3>
            <p className={styles.stepDesc}>
              {ios26 ? (
                <>
                  Desplaza y pulsa esta opción. Deja activado el
                  interruptor <strong>"Abrir como web app"</strong> y
                  confirma con "Añadir".
                </>
              ) : (
                <>
                  Desplaza hacia abajo en el menú y pulsa esta opción.
                  Confirma con "Añadir" en la esquina superior derecha.
                </>
              )}
            </p>
          </div>
        </li>

        <li className={styles.step}>
          <div className={styles.stepIcon} aria-hidden="true">
            <Icon name="Bell" size={26} />
          </div>
          <div className={styles.stepBody}>
            <span className={styles.stepNum}>3</span>
            <h3 className={styles.stepTitle}>Abre Ritmiq y activa las notifs</h3>
            <p className={styles.stepDesc}>
              Abre Ritmiq desde tu pantalla principal y vuelve a
              Ajustes &gt; Cuenta. El botón "Activar" ahora sí
              funcionará.
            </p>
          </div>
        </li>
      </ol>

      <div className={styles.note}>
        <Icon name="Info" size={14} />
        <span>
          También recibirás tus listas, descargas y configuración
          intactas — es la misma cuenta.
        </span>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onClose}
        >
          Entendido
        </button>
      </div>
    </Modal>
  );
}
