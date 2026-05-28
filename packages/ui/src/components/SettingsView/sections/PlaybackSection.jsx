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
import { useEffect, useState, useCallback } from 'react';
import { useSettingsStore, EQ_PRESETS } from '../../../stores/settings.js';
import { EQ_BANDS } from '../../../lib/html-audio-backend.js';
import { getSharedBackend } from '../../../lib/use-player.js';
import { isDesktop } from '../../../lib/api.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { Toggle } from '../controls/Toggle.jsx';
import { Slider } from '../controls/Slider.jsx';
import { SegmentedControl } from '../controls/SegmentedControl.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import { EqCurve } from './EqCurve.jsx';
import styles from '../SettingsView.module.css';

/** Formatea "hace X" de forma compacta y honesta. */
function relTimeShort(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 0) return 'ahora';
  if (d < 60_000) return `hace ${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `hace ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `hace ${Math.floor(d / 3_600_000)} h`;
  return `hace ${Math.floor(d / 86_400_000)} d`;
}

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
  const publishUrlCache = useSettingsStore((s) => s.publishUrlCache);
  const setPublishUrlCache = useSettingsStore((s) => s.setPublishUrlCache);
  const [eqError, setEqError] = useState(null);

  // Toggle del EQ. CRITICO iOS PWA: initGraphFromGesture() debe
  // ejecutarse SINCRONICAMENTE como primera operacion del handler para
  // capturar el "user gesture token" que Apple usa para validar el
  // resume del AudioContext. Si metemos cualquier await antes, el
  // gesto expira y el ctx queda suspended → silencio total con la
  // barra de progreso avanzando.
  //
  // Por eso la funcion NO es async. Hacemos la llamada sincrona y
  // manejamos el resultado con .then().
  const handleEqToggle = (next) => {
    setEqError(null);
    const backend = getSharedBackend();
    if (!next) {
      // Desactivar es seguro siempre — no requiere gesto. El subscriber
      // useApplyAudioSettings llamara backend.setEqEnabled(false).
      setEqEnabledStore(false);
      return;
    }
    if (!backend) {
      setEqError('Motor de audio no disponible. Reproduce algo primero.');
      return;
    }
    // PASO 1 (sincrono, dentro del gesto): crear el graph + disparar
    // resume. Si returna null, AudioContext API no esta disponible.
    const initPromise = backend.initGraphFromGesture();
    // PASO 2 (despues del gesto): activa el store. useApplyAudioSettings
    // subscribe → llama backend.setEqEnabled(true) + setEqGains() una
    // sola vez. Evitamos duplicar el connectChain manualmente aqui.
    initPromise.then((ok) => {
      if (!ok) {
        setEqError('No se pudo inicializar el ecualizador. Reproduce algo primero y vuelve a intentarlo.');
        return;
      }
      setEqEnabledStore(true);
    }).catch((err) => {
      setEqError(`Error: ${err?.message ?? 'desconocido'}`);
    });
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
          {/* Curva de respuesta combinada \u2014 reactiva a los sliders. */}
          <EqCurve gains={eqGains} />
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

      {/* Toggle "Compartir resoluciones" — solo en Desktop. En PWA no
       * aplica porque el navegador no puede ejecutar yt-dlp: el usuario
       * PWA solo CONSUME del cache, no contribuye. Mostrarlo ahi seria
       * deshonesto. */}
      {isDesktop ? (
        <PublishUrlCacheRow
          publishUrlCache={publishUrlCache}
          setPublishUrlCache={setPublishUrlCache}
        />
      ) : (
        <SettingRow
          label="Compartir resoluciones con la red Ritmiq"
          description="Esta funcion solo aplica a la version Desktop (puede ejecutar yt-dlp). En PWA reproduces desde el cache global compartido sin contribuir — sin contar nada extra."
          control={null}
        />
      )}
    </SettingsGroup>
  );
}

/**
 * Fila del toggle "Compartir resoluciones" con panel de telemetria
 * observable: contador de publicaciones, ultimo timestamp, alerta si
 * faltan envs en el main process, boton de prueba de conexion.
 *
 * Polling cada 5s mientras el componente esta montado. Se desmonta
 * cuando el usuario sale de Settings → cero impacto en background.
 */
function PublishUrlCacheRow({ publishUrlCache, setPublishUrlCache }) {
  const [stats, setStats] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, message, ms }
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState(null);

  const refreshStats = useCallback(async () => {
    try {
      const s = await window.ritmiq?.settings?.getPublishStats?.();
      if (s) setStats(s);
    } catch {
      /* fallo IPC — no propagamos, el UI muestra "Cargando..." */
    }
  }, []);

  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 5_000);
    return () => clearInterval(id);
  }, [refreshStats]);

  // Refresh inmediato cuando se cambia el toggle: el feedback "publicacion
  // desactivada" tiene que aparecer instantaneo para que el usuario lo
  // perciba como reactivo.
  const handleToggle = useCallback((v) => {
    setPublishUrlCache(v);
    setTimeout(refreshStats, 200);
  }, [setPublishUrlCache, refreshStats]);

  const handleClearCache = useCallback(async () => {
    setClearing(true);
    setClearMsg(null);
    try {
      const r = await window.ritmiq?.lan?.clearStreamCache?.();
      if (r?.ok) {
        setClearMsg(`Cache local vaciado (${r.cleared} entradas). Reproduce ahora cualquier cancion de YouTube para forzar yt-dlp + publish.`);
        setTimeout(refreshStats, 200);
      } else {
        setClearMsg('No se pudo vaciar el cache (LAN server no disponible).');
      }
    } catch (err) {
      setClearMsg(`Error: ${err?.message ?? err}`);
    } finally {
      setClearing(false);
    }
  }, [refreshStats]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const t0 = performance.now();
    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL/ANON_KEY en build');
      // ytId de prueba estable (Rick Astley) — alto chance de HIT si
      // alguien lo ha resuelto en las ultimas 24h. Sino MISS limpio.
      const res = await fetch(`${url}/functions/v1/get-stream-url?ytId=dQw4w9WgXcQ`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      const dt = Math.round(performance.now() - t0);
      if (res.status === 200) {
        setTestResult({ ok: true, message: `HIT (${dt} ms) — el cache global responde`, ms: dt });
      } else if (res.status === 404) {
        setTestResult({ ok: true, message: `MISS (${dt} ms) — Edge Function viva, cache vacio para ese ID`, ms: dt });
      } else {
        setTestResult({ ok: false, message: `HTTP ${res.status} (${dt} ms)`, ms: dt });
      }
    } catch (err) {
      const dt = Math.round(performance.now() - t0);
      setTestResult({ ok: false, message: `${err?.message ?? err} (${dt} ms)`, ms: dt });
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <>
      <SettingRow
        label="Compartir resoluciones con la red Ritmiq"
        description="Cuando tu PC resuelve una cancion con yt-dlp, otros usuarios sin acceso a tu equipo podran reproducirla al instante durante las proximas horas. No se comparte tu identidad ni que escuchas."
        control={
          <Toggle
            checked={publishUrlCache}
            onChange={handleToggle}
            ariaLabel="Compartir URLs resueltas anonimamente"
          />
        }
      />

      {/* Panel de telemetria — siempre visible cuando es Desktop para
       * que el usuario VEA si la cosa funciona o esta silenciosamente
       * rota. Sin esto el toggle era un acto de fe. */}
      <PublishStatsPanel
        stats={stats}
        toggleEnabled={publishUrlCache}
        onTest={handleTest}
        testing={testing}
        testResult={testResult}
        onClearCache={handleClearCache}
        clearing={clearing}
        clearMsg={clearMsg}
      />
    </>
  );
}

function PublishStatsPanel({
  stats, toggleEnabled, onTest, testing, testResult,
  onClearCache, clearing, clearMsg,
}) {
  // Estados criticos primero — un panel rojo es mas informativo que
  // un mensaje verde vacio.
  const noEnv = stats && !stats.hasUrl;
  const noSession = stats && !stats.hasSession;
  const skipReason = stats?.skippedReason;
  const skipConfig = skipReason === 'no_url' || skipReason === 'no_apikey';

  let tone = 'info';
  let icon = 'Info';
  let headline;
  let detail;

  if (!stats) {
    headline = 'Cargando estado...';
    detail = null;
  } else if (!toggleEnabled) {
    tone = 'info';
    icon = 'Pause';
    headline = 'Publicacion desactivada';
    detail = 'Activa el toggle para contribuir al cache global cuando resuelvas canciones.';
  } else if (noEnv || skipConfig) {
    tone = 'err';
    icon = 'AlertTriangle';
    headline = 'Falta configuracion de Supabase';
    detail = skipReason === 'no_url' || !stats.hasUrl
      ? 'VITE_SUPABASE_URL no llego al proceso main. Revisa .env.production empaquetado.'
      : 'No hay ANON_KEY del proyecto en el proceso main.';
  } else if (noSession || skipReason === 'no_session') {
    tone = 'err';
    icon = 'AlertTriangle';
    headline = 'Sin sesion de usuario';
    detail = 'Inicia sesion en Ritmiq para que tu JWT autorice la publicacion. La Edge publish-stream-url solo acepta tokens de usuarios reales (anti-spam).';
  } else if (stats.successes > 0) {
    tone = 'ok';
    icon = 'CheckCircle2';
    headline = `${stats.successes} ${stats.successes === 1 ? 'URL publicada' : 'URLs publicadas'}`;
    const parts = [`ultima ${relTimeShort(stats.lastSuccessAt)}`];
    if (stats.failures > 0) parts.push(`${stats.failures} fallos`);
    detail = parts.join(' · ');
  } else if (stats.failures > 0) {
    tone = 'err';
    icon = 'AlertTriangle';
    headline = `${stats.failures} ${stats.failures === 1 ? 'intento fallido' : 'intentos fallidos'}`;
    detail = stats.lastError?.message ?? 'Sin detalles.';
  } else if (stats.attempts > 0) {
    // Caso raro pero posible: intentos lanzados, ninguno completado
    // (en vuelo o algun bucle silencioso).
    tone = 'info';
    icon = 'Loader';
    headline = `${stats.attempts} ${stats.attempts === 1 ? 'publicacion en vuelo' : 'publicaciones en vuelo'}`;
    detail = 'Esperando confirmacion del Edge Function...';
  } else {
    tone = 'info';
    icon = 'Loader';
    headline = 'Esperando primera resolucion con yt-dlp';
    // Pista importante: el LAN server cachea internamente las URLs ya
    // resueltas, asi que reproducir la misma cancion 2x no dispara
    // publish la segunda vez (cache HIT local). Solo canciones NUEVAS
    // o tras 30 minutos disparan publish.
    detail = 'Reproduce una cancion de YouTube no escuchada en los ultimos 30 min. Si suena instantaneamente desde tu LAN local, es porque ya estaba en cache de memoria.';
  }

  return (
    <div className={styles.subBlock} style={{ gap: 'var(--space-2)' }}>
      <div className={styles.statusMsg} data-tone={tone} style={{ margin: 0 }}>
        <Icon name={icon} size={14} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{headline}</span>
          {detail && <span style={{ opacity: 0.85, marginTop: 2 }}>{detail}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className={styles.testBtn}
        >
          {testing ? 'Probando...' : 'Probar conexion'}
        </button>
        <button
          type="button"
          onClick={onClearCache}
          disabled={clearing || !stats?.streamCacheSize}
          className={styles.testBtn}
          title={stats?.streamCacheSize
            ? `Hay ${stats.streamCacheSize} URLs cacheadas en memoria. Borrarlas obligara a yt-dlp + publish en la proxima reproduccion.`
            : 'Cache local vacio; ya estas listo para que la proxima reproduccion dispare publish.'}
        >
          {clearing
            ? 'Vaciando...'
            : `Vaciar cache local${stats?.streamCacheSize ? ` (${stats.streamCacheSize})` : ''}`}
        </button>
        {testResult && (
          <span
            className={styles.statusMsg}
            data-tone={testResult.ok ? 'ok' : 'err'}
            style={{ margin: 0, flex: 1, minWidth: 0 }}
          >
            <Icon name={testResult.ok ? 'CheckCircle2' : 'X'} size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {testResult.message}
            </span>
          </span>
        )}
      </div>
      {clearMsg && (
        <div
          className={styles.statusMsg}
          data-tone="info"
          style={{ margin: 0 }}
        >
          <Icon name="Info" size={14} />
          <span>{clearMsg}</span>
        </div>
      )}

      {/* Footer tecnico: contadores crudos siempre visibles. Si la UI
       * arriba dice "Esperando..." pero attempts ya esta en N, el usuario
       * sabe que algo paso en main pero la red fallo. Si attempts=0 y
       * acaba de reproducir 5 canciones, sabe que el LAN server las
       * sirvio desde su cache de memoria sin disparar yt-dlp. */}
      {stats && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--color-text-3)',
          fontVariantNumeric: 'tabular-nums',
          flexWrap: 'wrap',
          paddingTop: 4,
        }}>
          <span>intentos: <b style={{ color: 'var(--color-text-1)' }}>{stats.attempts}</b></span>
          <span>exitos: <b style={{ color: stats.successes > 0 ? 'var(--color-success)' : 'var(--color-text-1)' }}>{stats.successes}</b></span>
          <span>fallos: <b style={{ color: stats.failures > 0 ? 'var(--color-danger)' : 'var(--color-text-1)' }}>{stats.failures}</b></span>
          {stats.skippedReason && (
            <span>skip: <b style={{ color: 'var(--color-warning, #fbbf24)' }}>{stats.skippedReason}</b></span>
          )}
          <span>env: {stats.hasUrl ? '✓url' : '✗url'} {stats.hasSession ? '✓sesion' : '✗sesion'}</span>
        </div>
      )}
    </div>
  );
}
