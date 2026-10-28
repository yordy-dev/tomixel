import { useEffect, useRef, useState } from 'react';

import { AudioLines, Camera, CircleDot, FolderClosed, Keyboard, Palette, FolderOpen, Check, Upload, Image, ScrollText, Pause, Play, Monitor, RotateCcw } from 'lucide-react';

import { hasTeleprompterScript, TELEPROMPTER_SPEED_LABELS, TELEPROMPTER_SPEEDS, type Config, type Settings as Preferences } from '../../shared/types';

import type { RecorderSnapshot } from '../services/recorder';

import { CameraPreview, Header, Meter, Select, SettingRow, Toggle } from '../components/ui';



type ShortcutName = 'record' | 'pause' | 'mic' | 'zoom150' | 'zoom200' | 'cameraSmall' | 'cameraMedium' | 'cameraFullscreen' | 'cameraImage';



function readableKey(key: string) { return key === 'Control' ? 'Ctrl' : key; }



function ShortcutCapture({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (value: string) => void }) {

  const [listening, setListening] = useState(false), [message, setMessage] = useState('');

  const button = useRef<HTMLButtonElement>(null);

  const keys = value.split('+');

  function capture(event: React.KeyboardEvent<HTMLButtonElement>) {

    if (!listening) return;

    event.preventDefault(); event.stopPropagation();

    if (event.key === 'Escape') { setListening(false); setMessage(''); return; }

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) { setMessage('Ahora presiona la segunda tecla.'); return; }

    const modifiers = [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : ''].filter(Boolean);

    const aliases: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '+': 'Plus', '-': 'Minus' };

    const next = aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);

    if (modifiers.length !== 1 || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Tab|Up|Down|Left|Right|Plus|Minus)$/.test(next)) {

      setMessage('Usa una tecla como Ctrl, Alt o Shift y una segunda tecla.'); return;

    }

    onChange(`${modifiers[0]}+${next}`); setListening(false); setMessage(''); button.current?.blur();

  }

  return <div className="shortcut-capture"><div><strong>{label}</strong><small>Dos teclas: una modificadora y una tecla final.</small></div><div className="shortcut-capture-actions"><button type="button" ref={button} className={`shortcut-key-button ${listening ? 'listening' : ''}`} onClick={() => { setListening(true); setMessage('Presiona las dos teclas ahora.'); button.current?.focus(); }} onKeyDown={capture} aria-label={`Cambiar ${label}`}>{listening ? 'Presiona dos teclas…' : keys.map(key => <kbd key={key}>{readableKey(key)}</kbd>)}</button><button type="button" className="text-button" onClick={() => { setListening(false); setMessage(''); onChange(fallback); }}>Restaurar</button></div>{message && <p className="shortcut-capture-message" role="status">{message}</p>}</div>;

}

function TeleprompterScriptEditor({ value, save, open, onError }: { value: string; save: (value: string) => Promise<void>; open: () => Promise<void>; onError: (error: unknown) => void }) {
  const [draft, setDraft] = useState(value), [status, setStatus] = useState('Guardado automáticamente.'), [attempt, setAttempt] = useState(0);
  const draftRef = useRef(value), dirty = useRef(false), pendingSave = useRef<Promise<void> | null>(null);
  const persist = (text: string) => {
    const task = save(text); pendingSave.current = task;
    void task.then(() => { if (pendingSave.current === task) pendingSave.current = null; }, () => { if (pendingSave.current === task) pendingSave.current = null; });
    return task;
  };
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (!dirty.current) {
      if (value !== draftRef.current) { draftRef.current = value; setDraft(value); }
      return;
    }
    if (value === draftRef.current) { dirty.current = false; setStatus('Guardado automáticamente.'); return; }
    const timer = window.setTimeout(() => {
      setStatus('Guardando…'); void persist(draftRef.current).catch(onError); setAttempt(current => current + 1);
    }, attempt ? 900 : 500);
    return () => window.clearTimeout(timer);
  }, [draft, value, attempt]);
  const commit = () => {
    if (!dirty.current || value === draftRef.current) return;
    setStatus('Guardando…'); void persist(draftRef.current).catch(onError); setAttempt(current => current + 1);
  };
  const openLatest = async () => {
    if (pendingSave.current) await pendingSave.current;
    if (value !== draftRef.current) await persist(draftRef.current);
    await open();
  };
  return <><label>Guion<textarea aria-label="Texto del teleprompter" aria-describedby="teleprompter-edit-help" value={draft} maxLength={30000} placeholder="Escribe o pega aquí tu guion…" onChange={event => { dirty.current = true; setStatus('Cambios pendientes.'); setAttempt(0); setDraft(event.target.value); }} onBlur={commit} /><small id="teleprompter-edit-help" className="teleprompter-edit-help"><span>{status}</span><span>Fórmulas: <code>$E=mc^2$</code> en línea o <code>$$\frac&#123;a&#125;&#123;b&#125;$$</code> centrada.</span></small></label><button className="primary" disabled={!hasTeleprompterScript(draft)} onClick={() => void openLatest().catch(onError)}><Play size={16} />Abrir teleprompter</button></>;
}

function CameraSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onChange(draft); };
  return <div className="camera-adjustment"><div><span>{label}</span><output>{draft > 0 ? '+' : ''}{draft}</output></div><input aria-label={label} type="range" min="-50" max="50" step="1" value={draft} onChange={event => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} /><div><small>−50</small><small>Neutro</small><small>+50</small></div></div>;
}



export function SettingsScreen({ config, state, initialTab, change, folder, back, error }: { config: Config; state: RecorderSnapshot; initialTab: string; change: (p: Partial<Preferences>) => Promise<void>; folder: () => void; back: () => void; error: (e: unknown) => void }) {

  const s = config.settings; const [tab, setTab] = useState(initialTab), [gain, setGain] = useState(s.micGain), [systemGain, setSystemGain] = useState(s.systemGain), [keys, setKeys] = useState(s.shortcuts), [shortcutCheck, setShortcutCheck] = useState<{ valid: boolean; errors: string[] } | null>(null), [checkingShortcuts, setCheckingShortcuts] = useState(false), [audioTest, setAudioTest] = useState(0);
  const recordingActive = ['recording', 'paused'].includes(state.phase);

  useEffect(() => { setGain(s.micGain); }, [s.micGain]);

  useEffect(() => { setSystemGain(s.systemGain); }, [s.systemGain]);

  useEffect(() => { setKeys(s.shortcuts); }, [s.shortcuts]);

  useEffect(() => { const timer = window.setTimeout(() => { setCheckingShortcuts(true); void window.desktop.validateShortcuts(keys).then(setShortcutCheck).catch(e => setShortcutCheck({ valid: false, errors: [e instanceof Error ? e.message : 'No se pudo validar los atajos.'] })).finally(() => setCheckingShortcuts(false)); }, 220); return () => window.clearTimeout(timer); }, [keys]);

  useEffect(() => { if (!audioTest) return; const timer = window.setInterval(() => setAudioTest(current => current <= 1 ? 0 : current - 1), 1000); return () => window.clearInterval(timer); }, [audioTest]);

  const tabs = [['audio', AudioLines, 'Audio'], ['video', Monitor, 'Video'], ['camera', Camera, 'Cámara'], ['recording', CircleDot, 'Grabación'], ['teleprompter', ScrollText, 'Guion'], ['storage', FolderClosed, 'Almacenamiento'], ['appearance', Palette, 'Apariencia'], ['shortcuts', Keyboard, 'Atajos']] as const;

  const microphones: [string, string][] = [['', 'Predeterminado'], ...state.microphones.filter(d => d.deviceId !== 'default').map((d, i): [string, string] => [d.deviceId, d.label || `Micrófono ${i + 1}`])];

  const cameras: [string, string][] = [['', 'Primera cámara disponible'], ...state.cameras.map((d, i): [string, string] => [d.deviceId, d.label || `Cámara ${i + 1}`])];

  const bool = (key: keyof Preferences, label: string, hint?: string, disabled = false) => <SettingRow label={label} hint={hint}><Toggle label={label} checked={s[key] as boolean} onChange={v => change({ [key]: v })} disabled={disabled} /></SettingRow>;

  return <><Header title="Ajustes" back={back} />{recordingActive && <div className="recording-settings-note" role="status"><Pause size={15} /><span><strong>Grabación en pausa.</strong> Guarda tus cambios y pulsa Volver para continuar. Los dispositivos, FPS y resolución nuevos se usarán desde la próxima toma.</span></div>}<div className="settings-layout"><nav className="settings-nav">{tabs.map(([id, Icon, label]) => <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}><Icon size={18} />{label}</button>)}<div className="settings-note"><span className="local-dot" />100% local<p>Tu equipo tiene el control.</p></div></nav><main className="settings-content"><h1>{tabs.find(t => t[0] === tab)?.[2]}</h1><p className="page-description">{tab === 'audio' ? 'Tu voz, clara y a tu manera.' : tab === 'video' ? 'Conserva el detalle de tu pantalla.' : tab === 'camera' ? 'Ajusta tu imagen antes de grabar.' : 'Haz que grabar se sienta natural.'}</p>

    {tab === 'audio' && <><section className="settings-card"><SettingRow label="Micrófono"><Select label="Dispositivo de micrófono" value={s.micId} options={microphones} onChange={v => change({ micId: v })} /></SettingRow>{bool('micEnabled', 'Usar micrófono')}<div className="meter-section"><div><span>Pico del micrófono</span><small>{state.mic ? 'Habla normalmente y evita llegar a rojo' : 'Micrófono inactivo'}</small></div><Meter level={state.level} showScale /></div></section><h2>Procesamiento de voz</h2><section className="settings-card"><SettingRow label="Perfil de voz" hint={s.voiceProfile === 'natural' ? 'Conserva el tono y reduce el ruido sin cerrar la voz.' : s.voiceProfile === 'noisy' ? 'Atenúa con más fuerza ventiladores, tráfico y ruido constante.' : s.voiceProfile === 'room' ? 'Reduce graves de habitación y colas de reverberación entre frases.' : 'Prioriza la cancelación de lo que sale por los altavoces.'}><Select label="Perfil de voz" value={s.voiceProfile} options={[["natural", 'Natural · recomendado'], ['noisy', 'Entorno ruidoso'], ['room', 'Habitación con eco'], ['speakers', 'Altavoces activos']]} onChange={v => change({ voiceProfile: v as Preferences['voiceProfile'] })} /></SettingRow>{bool('neuralNoiseSuppression', 'Supresión inteligente de ruido', !s.neuralNoiseSuppression ? 'Desactivada.' : state.denoiserModel === 'gtcrn' ? 'GTCRN activo · mejora la voz y elimina ruido incluso mientras hablas.' : state.denoiserModel === 'rnnoise' ? 'RNNoise de respaldo activo.' : state.denoiserModel === 'device' ? 'Los modelos no pudieron iniciarse; se usa la supresión del dispositivo.' : 'Preparando GTCRN…')}<SettingRow label="Acondicionamiento adaptativo" hint="Mide el ruido de tu habitación y atenúa pausas, graves molestos y cambios bruscos sin cortar palabras."><span>{state.mic ? `Activo · piso de ruido ${state.noiseFloorDb} dB` : 'Se calibra al activar el micrófono'}</span></SettingRow><details className="advanced-audio"><summary>Diagnóstico del dispositivo</summary><div>{(['noiseSuppression', 'echoCancellation', 'autoGainControl'] as const).map((key, i) => {

      const supported = !!navigator.mediaDevices.getSupportedConstraints()[key] && (!state.audioSettings || typeof state.audioSettings[key] === 'boolean');

      const actual = state.audioSettings?.[key]; const names = ['Supresión básica del dispositivo', 'Cancelación de eco', 'Ganancia automática'];

      const requested = key === 'noiseSuppression' && s.neuralNoiseSuppression ? false : key === 'echoCancellation' && s.voiceProfile === 'speakers' ? true : s[key];

      const neuralOverride = key === 'noiseSuppression' && s.neuralNoiseSuppression;
      const speakerOverride = key === 'echoCancellation' && s.voiceProfile === 'speakers';

      const hint = neuralOverride ? 'Desactivada para evitar doble procesamiento con el modelo neuronal.' : speakerOverride ? 'Activada por el perfil Altavoces activos.' : !supported ? 'No expuesto por este dispositivo o controlador.' : actual === undefined ? 'Se comprobará al activar el micrófono.' : `Dispositivo: ${actual ? 'activado' : 'desactivado'}${actual !== requested ? ' · El controlador no aplicó el valor solicitado.' : ''}`;
      return <SettingRow key={key} label={names[i]} hint={hint}><Toggle label={names[i]} checked={Boolean(requested)} onChange={value => change({ [key]: value })} disabled={!supported || neuralOverride || speakerOverride} /></SettingRow>;

    })}</div></details><div className="gain"><div><span>Volumen del micrófono</span><strong>{Math.round(gain * 100)}%</strong></div><input aria-label="Volumen del micrófono" type="range" min="0" max="2" step="0.05" value={gain} onChange={e => setGain(Number(e.target.value))} onPointerUp={() => change({ micGain: gain })} onKeyUp={() => change({ micGain: gain })} /><div className="range-labels"><small>0%</small><small>Recomendado: 80%</small><small>200%</small></div></div></section><h2>Mezcla</h2><section className="settings-card">{bool('systemAudio', 'Audio del sistema', config.systemAudioSupported ? 'Captura la salida de Windows, incluso al grabar una ventana.' : 'No disponible en esta plataforma.', !config.systemAudioSupported)}<div className="meter-section system-meter"><div><span>Pico del sistema</span><small>{state.systemAudioActual ? 'Señal detectada durante la captura' : 'Se mostrará al iniciar una grabación con audio del sistema'}</small></div><Meter level={state.systemLevel} showScale /></div><div className="gain"><div><span>Volumen del sistema</span><strong>{Math.round(systemGain * 100)}%</strong></div><input aria-label="Volumen del sistema" type="range" min="0" max="1" step="0.05" value={systemGain} disabled={!s.systemAudio || !config.systemAudioSupported} onChange={e => setSystemGain(Number(e.target.value))} onPointerUp={() => change({ systemGain })} onKeyUp={() => change({ systemGain })} /><div className="range-labels"><small>0%</small><small>Recomendado: 55%</small><small>100%</small></div></div></section></>}

    {tab === 'video' && <section className="settings-card"><SettingRow label="Fluidez de pantalla" hint="Con cámara activa, la grabación se sincroniza a los FPS reales de la webcam para evitar retraso entre imagen y voz."><Select label="FPS de pantalla" value={s.screenFps} options={[[30, '30 FPS'], [60, '60 FPS']]} onChange={v => change({ screenFps: Number(v) })} /></SettingRow><SettingRow label="Calidad de grabación" hint="WebM · Códec automático compatible"><Select label="Calidad de grabación" value={s.quality} options={[["low", 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['very-high', 'Muy alta']]} onChange={v => change({ quality: v as Preferences['quality'] })} /></SettingRow><SettingRow label="Maestro de grabación" hint="La pantalla se conserva a su resolución real para que el zoom tenga todos los píxeles disponibles."><span>Resolución nativa</span></SettingRow><SettingRow label="Resolución del MP4" hint="Se aplica al exportar. El WebM maestro permanece intacto para futuras ediciones."><Select label="Resolución del MP4" value={s.captureResolution} options={[["1080p", '1080p · recomendado'], ['1440p', '1440p'], ['2160p', '4K'], ['native', 'Igual al original']]} onChange={v => change({ captureResolution: v as Preferences['captureResolution'] })} /></SettingRow></section>}

    {tab === 'camera' && <>
      <section className="settings-card"><SettingRow label="Dispositivo"><Select label="Dispositivo de cámara" value={s.cameraId} options={cameras} onChange={v => change({ cameraId: v })} /></SettingRow>{bool('cameraEnabled', 'Usar cámara')}<div className="camera-setting-preview">{state.cameraStream ? <CameraPreview stream={state.cameraStream} mirror={s.mirrorPreview} /> : <span>Cámara desactivada o no disponible</span>}<small>{state.cameraSettings ? `${state.cameraSettings.width} × ${state.cameraSettings.height} · ${Math.round(state.cameraSettings.frameRate || 0)} FPS reales` : 'Vista previa'}</small></div><SettingRow label="Resolución preferida"><Select label="Resolución de cámara" value={s.cameraResolution} options={[[720, '720p'], [1080, '1080p']]} onChange={v => change({ cameraResolution: Number(v) })} /></SettingRow><SettingRow label="Fluidez preferida" hint="Se usa la alternativa que admita la cámara."><Select label="FPS de cámara" value={s.cameraFps} options={[[30, '30 FPS'], [60, '60 FPS']]} onChange={v => change({ cameraFps: Number(v) })} /></SettingRow>{bool('mirrorPreview', 'Vista previa en espejo', 'Solo la vista previa. El video final conserva la orientación original.')}</section>
      <h2>Luz y color</h2><section className="settings-card camera-appearance-settings">{bool('cameraAutoLight', 'Corrección automática de luz', 'Compensa de forma gradual una imagen demasiado oscura sin quemar las luces.')}<CameraSlider label="Brillo" value={s.cameraBrightness} onChange={cameraBrightness => void change({ cameraBrightness })} /><CameraSlider label="Contraste" value={s.cameraContrast} onChange={cameraContrast => void change({ cameraContrast })} /><CameraSlider label="Temperatura" value={s.cameraTemperature} onChange={cameraTemperature => void change({ cameraTemperature })} /><CameraSlider label="Saturación" value={s.cameraSaturation} onChange={cameraSaturation => void change({ cameraSaturation })} /><div className="camera-reset"><button className="secondary" onClick={() => void change({ cameraAutoLight: false, cameraBrightness: 0, cameraContrast: 0, cameraTemperature: 0, cameraSaturation: 0 })}><RotateCcw size={15} />Restablecer luz y color</button></div></section>
      <h2>Fondo</h2><section className="settings-card"><SettingRow label="Efecto de fondo" hint="La separación de la persona se procesa únicamente en este equipo."><Select label="Efecto de fondo" value={s.cameraBackground} options={[["none", 'Sin efecto'], ['blur-soft', 'Desenfoque suave'], ['blur-strong', 'Desenfoque fuerte'], ['image', 'Imagen personalizada']]} onChange={value => { const cameraBackground = value as Preferences['cameraBackground']; if (cameraBackground === 'image' && !s.cameraBackgroundImage) void window.desktop.chooseCameraBackground().catch(error); else void change({ cameraBackground }); }} /></SettingRow><SettingRow label="Rendimiento" hint={state.cameraEffectPerformance === 'limited' ? 'La separación tarda más de lo esperado. El video mantiene sus FPS usando la última máscara disponible.' : state.cameraEffectPerformance === 'unavailable' ? 'No se pudo cargar el modelo local; se mantiene la cámara sin recorte.' : 'El efecto se procesa aparte para no detener los fotogramas de la cámara.'}><span className={`camera-performance ${state.cameraEffectPerformance}`}>{state.cameraEffectPerformance === 'optimal' ? 'Óptimo' : state.cameraEffectPerformance === 'limited' ? 'Limitado' : state.cameraEffectPerformance === 'loading' ? 'Preparando…' : state.cameraEffectPerformance === 'unavailable' ? 'No disponible' : 'Sin efecto'}</span></SettingRow>{s.cameraBackgroundImage && <div className="camera-background-preview"><img src={s.cameraBackgroundImage} alt="Fondo personalizado de cámara" /><div><button className="secondary" onClick={() => void window.desktop.chooseCameraBackground().catch(error)}><Upload size={15} />Cambiar fondo</button><button className="text-button" onClick={() => void change({ cameraBackgroundImage: '', cameraBackground: 'none' })}>Quitar</button></div></div>}{!s.cameraBackgroundImage && <div className="camera-background-empty"><Image size={25} /><span><strong>Imagen personalizada</strong><small>JPG, PNG o WebP · se guarda únicamente en este equipo.</small></span><button className="secondary" onClick={() => void window.desktop.chooseCameraBackground().catch(error)}><Upload size={15} />Elegir imagen</button></div>}</section>
      <h2>Burbuja de cámara</h2><section className="settings-card"><SettingRow label="Tamaño"><Select label="Tamaño de cámara" value={s.size} options={[["small", 'Pequeña'], ['medium', 'Mediana'], ['large', 'Grande']]} onChange={v => change({ size: v as Preferences['size'] })} /></SettingRow><SettingRow label="Posición inicial" hint="Puedes arrastrar la burbuja mientras grabas."><Select label="Posición de cámara" value={s.position} options={[["top-left", 'Arriba a la izquierda'], ['top-right', 'Arriba a la derecha'], ['bottom-left', 'Abajo a la izquierda'], ['bottom-right', 'Abajo a la derecha']]} onChange={v => change({ position: v as Preferences['position'] })} /></SettingRow></section>
      <h2>Imagen de cámara</h2><section className="settings-card camera-image-settings"><div className="avatar-preview">{s.cameraImage ? <img src={s.cameraImage} alt="Imagen cargada para la cámara" /> : <Image size={28} />}</div><div><p>Usa una imagen en lugar de tu webcam.</p><small>PNG, JPG o WebP · Hasta 8 MB. Se guarda solo en este equipo. Actívala con el quinto icono del menú de la burbuja.</small><div className="avatar-actions"><button className="secondary" onClick={() => void window.desktop.chooseCameraImage().catch(error)}><Upload size={15} />{s.cameraImage ? 'Cambiar imagen' : 'Cargar imagen'}</button>{s.cameraImage && <button className="text-button" onClick={() => change({ cameraImage: '', cameraView: s.cameraView === 'image' ? 'bubble' : s.cameraView })}>Quitar imagen</button>}</div></div></section>
    </>}

    {tab === 'recording' && <section className="settings-card"><SettingRow label="Cuenta regresiva"><Select label="Cuenta regresiva" value={s.countdown} options={[[0, 'Desactivada'], [3, '3 segundos'], [5, '5 segundos'], [10, '10 segundos']]} onChange={v => change({ countdown: Number(v) })} /></SettingRow>{bool('cursorEffects', 'Resaltar cursor y clics', 'Añade un halo amarillo al cursor y un pulso rojo al hacer clic en una pantalla.')}{bool('alwaysOnTop', 'Controles siempre visibles', 'Mantener encima de otras ventanas.')}{bool('showControls', 'Mostrar controles', 'Si los ocultas, usa el atajo de detener o la barra de tareas.', config.shortcutErrors.length > 0)}{bool('autoSave', 'Guardar automáticamente', 'Al detener, guardar antes de abrir la vista previa.')}{bool('openAfterSave', 'Abrir carpeta al guardar')}</section>}
    {tab === 'teleprompter' && <section className="settings-card teleprompter-settings"><TeleprompterScriptEditor value={s.teleprompterText} save={teleprompterText => change({ teleprompterText })} open={() => window.desktop.showTeleprompter()} onError={error} /><SettingRow label="Velocidad" hint="Usa ↑ y ↓ dentro del teleprompter para cambiar entre estos cinco niveles."><Select label="Velocidad del teleprompter" value={s.teleprompterSpeed} options={TELEPROMPTER_SPEEDS.map((speed, index) => [speed, `${TELEPROMPTER_SPEED_LABELS[index]} · ${speed} palabras/min`])} onChange={value => change({ teleprompterSpeed: Number(value) })} /></SettingRow><div className="gain"><div><span>Tamaño del texto</span><strong>{s.teleprompterFontSize}px</strong></div><input aria-label="Tamaño del texto del teleprompter" type="range" min="18" max="72" step="2" value={s.teleprompterFontSize} onChange={event => change({ teleprompterFontSize: Number(event.target.value) })} /></div><div className="gain"><div><span>Ancho</span><strong>{s.teleprompterWidth}px</strong></div><input aria-label="Ancho del teleprompter" type="range" min="360" max="1200" step="20" value={s.teleprompterWidth} onChange={event => change({ teleprompterWidth: Number(event.target.value) })} /></div><div className="gain"><div><span>Opacidad</span><strong>{Math.round(s.teleprompterOpacity * 100)}%</strong></div><input aria-label="Opacidad del teleprompter" type="range" min="0.35" max="1" step="0.05" value={s.teleprompterOpacity} onChange={event => change({ teleprompterOpacity: Number(event.target.value) })} /></div><small>El guion queda fuera de la grabación. Atajos: Espacio reproduce o pausa; Inicio vuelve arriba; ↑/↓ cambian la velocidad entre cinco niveles.</small></section>}

    {tab === 'storage' && <section className="settings-card storage-card"><FolderClosed size={32} /><h2>Todo se queda aquí</h2><p>Los videos y la biblioteca se guardan en esta carpeta.</p><code>{config.root}</code><button className="secondary" onClick={folder} disabled={recordingActive}><FolderOpen size={16} />Cambiar carpeta</button><button className="text-button" onClick={() => void window.desktop.openFolder().catch(error)}>Abrir carpeta de grabaciones</button><small>{recordingActive ? 'Termina la toma para cambiar la carpeta sin separar sus fragmentos.' : 'Cambiar la ubicación abre la biblioteca de esa carpeta. Los videos anteriores permanecen en su ubicación.'}</small></section>}

    {tab === 'appearance' && <section className="settings-card"><SettingRow label="Tema"><Select label="Tema" value={s.theme} options={[["system", 'Seguir al sistema'], ['light', 'Claro'], ['dark', 'Oscuro']]} onChange={v => change({ theme: v as Preferences['theme'] })} /></SettingRow></section>}

    {tab === 'shortcuts' && <section className="settings-card shortcut-settings"><p>Elige cada atajo presionando dos teclas. Funcionan aunque Tomixel esté en segundo plano. Repetir un atajo de zoom regresa la grabación a 100%.</p>{(['record', 'pause', 'mic', 'zoom150', 'zoom200', 'cameraSmall', 'cameraMedium', 'cameraFullscreen', 'cameraImage'] as ShortcutName[]).map((key, i) => <ShortcutCapture key={key} label={['Iniciar / detener', 'Pausar / reanudar', 'Silenciar / activar micrófono', 'Zoom 150%', 'Zoom 200%', 'Cámara pequeña', 'Cámara mediana', 'Cámara a pantalla completa', 'Usar imagen de cámara'][i]} value={keys[key]} fallback={(['Control+R', 'Control+P', 'Control+M', 'Control+1', 'Control+2', 'Control+Q', 'Control+W', 'Control+E', 'Control+I'] as const)[i]} onChange={value => setKeys(current => ({ ...current, [key]: value }))} />)}{shortcutCheck && !shortcutCheck.valid && <p className="warning-text">{shortcutCheck.errors.join(' ')}</p>}<button className="secondary" disabled={checkingShortcuts || shortcutCheck?.valid === false} onClick={() => change({ shortcuts: keys })}><Check size={16} />{checkingShortcuts ? 'Comprobando…' : 'Guardar atajos'}</button>{config.shortcutErrors.length > 0 && <p className="warning-text">No se pudieron registrar: {config.shortcutErrors.join(', ')}. Elige otra combinación; puede estar reservada por Windows u otra aplicación.</p>}</section>}

  </main></div></>;

}

