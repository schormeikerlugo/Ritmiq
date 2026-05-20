/**
 * UI de settings de audio — EQ por bandas + crossfade.
 * Renderiza dentro de una AccordionSection en AccountView.
 *
 * @module @ritmiq/ui/components/AudioSettings
 */
import { useSettingsStore, EQ_PRESETS } from '../../stores/settings.js';
import { EQ_BANDS } from '../../lib/html-audio-backend.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './AudioSettings.module.css';

const PRESET_OPTIONS = [
  { id: 'flat',    label: 'Plano' },
  { id: 'bass',    label: 'Bass boost' },
  { id: 'vocal',   label: 'Voz' },
  { id: 'rock',    label: 'Rock' },
  { id: 'pop',     label: 'Pop' },
  { id: 'classic', label: 'Clasico' },
  { id: 'electro', label: 'Electro' },
];

export function AudioSettings() {
  const crossfade = useSettingsStore((s) => s.crossfadeSeconds);
  const setCrossfade = useSettingsStore((s) => s.setCrossfade);
  const eqEnabled = useSettingsStore((s) => s.eqEnabled);
  const setEqEnabled = useSettingsStore((s) => s.setEqEnabled);
  const eqGains = useSettingsStore((s) => s.eqGains);
  const setEqBand = useSettingsStore((s) => s.setEqBand);
  const eqPreset = useSettingsStore((s) => s.eqPreset);
  const setEqPreset = useSettingsStore((s) => s.setEqPreset);
  const resetAudio = useSettingsStore((s) => s.resetAudio);

  return (
    <div className={styles.wrap}>
      {/* ── Crossfade ─────────────────────────────────────────────── */}
      <div className={styles.row}>
        <div className={styles.rowHead}>
          <div>
            <div className={styles.label}>Crossfade</div>
            <div className={styles.hint}>
              Fundido suave al saltar de cancion manualmente.{' '}
              {crossfade === 0 ? 'Desactivado.' : `${crossfade.toFixed(1)} segundos.`}
            </div>
          </div>
          {crossfade > 0 && (
            <button
              type="button"
              className={styles.miniBtn}
              onClick={() => setCrossfade(0)}
              aria-label="Desactivar crossfade"
            >Off</button>
          )}
        </div>
        <input
          type="range"
          min="0"
          max="8"
          step="0.5"
          value={crossfade}
          onChange={(e) => setCrossfade(parseFloat(e.target.value))}
          className={styles.slider}
          aria-label="Duracion del crossfade en segundos"
        />
        <div className={styles.tickRow}>
          <span>0s</span><span>4s</span><span>8s</span>
        </div>
      </div>

      {/* ── EQ master switch ──────────────────────────────────────── */}
      <div className={styles.row}>
        <div className={styles.rowHead}>
          <div>
            <div className={styles.label}>Ecualizador</div>
            <div className={styles.hint}>
              6 bandas con presets. Solo aplica al audio en este dispositivo.
            </div>
          </div>
          <Toggle checked={eqEnabled} onChange={setEqEnabled} />
        </div>
      </div>

      {/* Sliders + presets (solo si EQ activo) */}
      {eqEnabled && (
        <>
          <div className={styles.presetTabs} role="tablist">
            {PRESET_OPTIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={eqPreset === p.id}
                data-active={eqPreset === p.id}
                className={styles.presetTab}
                onClick={() => setEqPreset(p.id)}
              >{p.label}</button>
            ))}
            {eqPreset === 'custom' && (
              <button
                type="button"
                role="tab"
                aria-selected
                data-active
                className={styles.presetTab}
                onClick={() => setEqPreset('flat')}
              >Custom</button>
            )}
          </div>

          <div className={styles.eqGrid}>
            {EQ_BANDS.map((band, i) => (
              <div key={band.freq} className={styles.eqBand}>
                <span className={styles.eqVal}>
                  {eqGains[i] > 0 ? '+' : ''}{eqGains[i].toFixed(1)}
                </span>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={eqGains[i]}
                  onChange={(e) => setEqBand(i, parseFloat(e.target.value))}
                  className={styles.eqSlider}
                  orient="vertical"
                  aria-label={`Banda ${band.label} Hz`}
                />
                <span className={styles.eqLabel}>{band.label}</span>
              </div>
            ))}
          </div>

          <div className={styles.eqFoot}>
            <span className={styles.hint}>Ganancia en dB. Rango: -12 a +12.</span>
            <button
              type="button"
              className={styles.miniBtn}
              onClick={() => setEqPreset('flat')}
            >Resetear</button>
          </div>
        </>
      )}

      <div className={styles.row}>
        <button
          type="button"
          className={styles.dangerBtn}
          onClick={resetAudio}
        >
          <Icon name="AlertCircle" size={14} />
          <span>Restaurar valores por defecto</span>
        </button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-on={checked}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleDot} />
    </button>
  );
}
