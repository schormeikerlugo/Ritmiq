/**
 * Modal de ayuda con la lista de atajos de teclado.
 * Se abre desde el hook `useGlobalShortcuts` cuando el usuario pulsa "?".
 * Renderiza dentro del BottomSheet global.
 *
 * @module @ritmiq/ui/components/ShortcutsHelp
 */
import styles from './ShortcutsHelp.module.css';

const SHORTCUTS = [
  { keys: ['Espacio'],          label: 'Reproducir / Pausar' },
  { keys: ['→'],                label: 'Siguiente pista' },
  { keys: ['←'],                label: 'Pista anterior' },
  { keys: ['↑'],                label: 'Subir volumen' },
  { keys: ['↓'],                label: 'Bajar volumen' },
  { keys: ['M'],                label: 'Silenciar / Restaurar' },
  { keys: ['Ctrl', 'K'],        label: 'Buscar' },
  { keys: ['/'],                label: 'Buscar (atajo rapido)' },
  { keys: ['?'],                label: 'Mostrar esta ayuda' },
];

export function ShortcutsHelp() {
  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>
        Solo en desktop. Los atajos se desactivan cuando estas escribiendo
        en un campo de texto.
      </p>
      <dl className={styles.list}>
        {SHORTCUTS.map((s, i) => (
          <div key={i} className={styles.row}>
            <dt className={styles.keys}>
              {s.keys.map((k, j) => (
                <kbd key={j} className={styles.kbd}>{k}</kbd>
              ))}
            </dt>
            <dd className={styles.label}>{s.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
