/**
 * Seccion de Reproduccion — crossfade + ecualizador.
 *
 * El EQ es opt-in: el toggle inicializa el WebAudio graph dentro del
 * gesto del click (critico iOS PWA). Si esta off, los sliders no se
 * muestran. Si esta on, aparece un sub-bloque con preset selector y
 * grid de 6 bandas.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/PlaybackSection
 */
import { useState } from 'react';
import { useSettingsStore, EQ_PRESETS } from '../../../stores/settings.js';
import { EQ_BANDS } from '../../../lib/html-audio-backend.js';
import { getSharedBackend } from '../../../lib/use-player.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { Toggle } from '../controls/Toggle.jsx';
import { Slider } from '../controls/Slider.jsx';
import { SegmentedControl } from '../controls/SegmentedControl.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import styles from '../SettingsView.module.css';

const PRESETS = [
  { id: 'flat',    label: 'Plano' },
  { id: 'bass',    label: 'Bass' },
  { id: 'vocal',   label: 'Voz' },
  { id: 'rock',    label: 'Rock' },
  { id: 'pop',     label: 'Pop' },
  { id: 'classic', label: 'Clasico' },
  { id: 'electro', label: 'Electro' },
];

export function PlaybackSection() {
  const crossfade = useSettingsStore((s) => s.crossfadeSeconds);
  const setCrossfade = useSettingsStore((s) => s.setCrossfade);
  const eqEnabled = useSettingsStore((s) => s.eqEnabled);
  const setEqEnabledStore = useSettingsStore((s) => s.setEqEnabled);
  const eqGains = useSettingsStore((s) => s.eqGains);
  const setEqBand = useSettingsStore((s) => s.setEqBand);
  const eqPreset = useSettingsStore((s) => s.eqPreset);
  const setEqPreset = useSettingsStore((s) => s.setEqPreset);
  const [eqError, setEqError] = useState(null);

  // Toggle del EQ — debe ejecutar initGraphFromGesture SINCRONICAMENTE
  // desde el onClick para que iOS PWA acepte el resume del AudioContext.
  const handleEqToggle = async (next) => {
    setEqError(null);
    const backend = getSharedBackend();
    if (!next) {
      setEqEnabledStore(false);
      backend?.setEqEnabled(false);
      return;
    }
    if (!backend) {
      setEqError('Motor de audio no disponible. Reproduce algo primero.');
      return;
    }
    try {
      const ok = await backend.initGraphFromGesture();
      if (!ok) {
        setEqError('No se pudo inicializar el ecualizador. Intenta reproducir una cancion primero.');
        return;
      }
      backend.setEqEnabled(true);
      backend.setEqGains(eqGains);
      setEqEnabledStore(true);
    } catch (err) {
      setEqError(`Error: ${err?.message ?? 'desconocido'}`);
    }
  };

  return (
    <SettingsGroup title="Reproduccion">
      <SettingRow
        label="Crossfade"
        description={
          crossfade === 0
            ? 'Desactivado. Las canciones cambian sin fundido.'
            : 'Fundido suave al cambiar de cancion manualmente.'
        }
        control={
          <Slider
            value={crossfade}
            min={0}
            max={8}
            step={0.5}
            onChange={setCrossfade}
            format={(v) => v === 0 ? 'Off' : `${v.toFixed(1)} s`}
            ariaLabel="Duracion del crossfade"
          />
        }
      />

      <SettingRow
        label="Ecualizador"
        description="6 bandas con presets. Activalo mientras suena algo para evitar interrupciones de audio."
        control={
          <Toggle
            checked={eqEnabled}
            onChange={handleEqToggle}
            ariaLabel="Activar ecualizador"
          />
        }
      />

      {eqError && (
        <div className={styles.statusMsg} data-tone="err" role="alert">
          <Icon name="AlertTriangle" size={14} />
          <span>{eqError}</span>
        </div>
      )}

      {eqEnabled && (
        <div className={styles.subBlock}>
          <SegmentedControl
            value={eqPreset === 'custom' ? 'flat' : eqPreset}
            options={PRESETS}
            onChange={setEqPreset}
            ariaLabel="Preset de ecualizador"
          />
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
                  aria-label={`Banda ${band.label} Hz`}
                />
                <span className={styles.eqLabel}>{band.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}
