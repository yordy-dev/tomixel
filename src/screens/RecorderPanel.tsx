import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, FolderClosed, Mic, Monitor, ScrollText, Settings2, ShieldCheck, Video, Volume2 } from 'lucide-react';
import type { Config, Settings, Source } from '../../shared/types';
import type { RecorderSnapshot } from '../services/recorder';
import { Header, Meter, Toggle } from '../components/ui';

export function RecorderPanel({ config, state, source, change, navigate, start }: { config: Config; state: RecorderSnapshot; source: Source | null; change: (patch: Partial<Settings>) => void; navigate: (page: string) => void; start: () => void }) {
  const s = config.settings;
  const [freeBytes, setFreeBytes] = useState(0);
  useEffect(() => { void window.desktop.storageStats().then(value => setFreeBytes(value.freeBytes)).catch(() => setFreeBytes(-1)); }, [config.root]);
  const micName = state.audioSettings?.deviceId ? state.microphones.find(d => d.deviceId === state.audioSettings?.deviceId)?.label : '';
  const cameraName = state.cameraSettings?.deviceId ? state.cameras.find(d => d.deviceId === state.cameraSettings?.deviceId)?.label : '';
  const ready = state.ready && freeBytes !== 0;
  return <><Header /><main className="recorder-panel">
    <p className="eyebrow">TU ESPACIO. TU GRABACIÓN.</p>
    <button className="source-card" data-tour="source" onClick={() => navigate('sources')}><span className="source-icon"><Monitor size={22} /></span><span><small>Qué quieres grabar</small><strong>{source?.name || 'Elegir pantalla o ventana'}</strong></span><ChevronDown size={17} /></button>
    <div data-tour="devices"><div className="device-row"><Video size={20} /><button className="device-label" onClick={() => navigate('settings-camera')} title={cameraName || 'Seleccionar cámara'}>{cameraName || (state.cameras.length ? 'Cámara disponible' : 'Sin cámara')}<ChevronDown size={13} /></button><Toggle label="Activar cámara" checked={s.cameraEnabled} onChange={on => change({ cameraEnabled: on })} disabled={!state.cameras.length && state.ready} /></div>
    <div className="device-with-meter"><div className="device-row"><Mic size={20} /><button className="device-label" onClick={() => navigate('settings-audio')} title={micName || 'Seleccionar micrófono'}>{micName || (state.microphones.length ? 'Micrófono predeterminado' : 'Sin micrófono')}<ChevronDown size={13} /></button><Toggle label="Activar micrófono" checked={s.micEnabled} onChange={on => change({ micEnabled: on })} disabled={!state.microphones.length && state.ready} /></div><Meter level={state.level} /></div>
    <div className="device-row"><Volume2 size={20} /><span className="device-label">Audio del sistema</span><Toggle label="Audio del sistema" checked={s.systemAudio} onChange={on => change({ systemAudio: on })} disabled={!config.systemAudioSupported} /></div></div>
    <details className="preflight"><summary><span>{source && ready && freeBytes > 512 * 1024 * 1024 ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}Diagnóstico previo</span><small>Fuente · dispositivos · espacio</small></summary><div>
      <p className={source ? 'ok' : 'warn'}>{source ? <CheckCircle2 /> : <AlertTriangle />}<span>Fuente<strong>{source ? `${source.crop ? 'Recorte configurado' : source.name}${source.width ? ` · ${source.width}×${source.height}` : ''}` : 'Elige qué grabar'}</strong></span></p>
      <p className={state.ready ? 'ok' : 'warn'}>{state.ready ? <CheckCircle2 /> : <AlertTriangle />}<span>Dispositivos<strong>{state.preparation || `${s.micEnabled ? state.mic ? 'Micrófono listo' : 'Micrófono no disponible' : 'Sin micrófono'} · ${s.cameraEnabled ? state.camera ? 'Cámara lista' : 'Cámara no disponible' : 'Sin cámara'}`}</strong></span></p>
      <p className={freeBytes > 512 * 1024 * 1024 ? 'ok' : 'warn'}>{freeBytes > 512 * 1024 * 1024 ? <CheckCircle2 /> : <AlertTriangle />}<span>Almacenamiento<strong>{freeBytes > 0 ? `${(freeBytes / 1024 ** 3).toFixed(1)} GB libres` : freeBytes < 0 ? 'No se pudo comprobar' : 'Comprobando…'}</strong></span></p>
      <p className="ok"><CheckCircle2 /><span>Video<strong>Maestro nativo · MP4 {s.captureResolution === 'native' ? 'original' : s.captureResolution} · {s.screenFps} FPS</strong></span></p>
    </div></details>
    {!state.ready && <p className="preparation-status" role="status">{state.preparation || 'Preparando dispositivos…'} Si un permiso falla, revisa Ajustes de privacidad de Windows y vuelve a elegir el dispositivo.</p>}
    <button className="primary record-button" data-tour="record" onClick={start} disabled={!ready}><span className="record-dot" />{state.ready ? 'Iniciar grabación' : 'Preparando dispositivos…'}</button>
    <p className="privacy"><ShieldCheck size={13} />Solo en tu equipo · Sin límite de tiempo</p>
    <footer className="panel-footer"><button data-tour="settings" onClick={() => navigate('settings')}><Settings2 size={18} />Ajustes</button><button onClick={() => s.teleprompterText.trim() ? void window.desktop.showTeleprompter().catch(() => navigate('settings-teleprompter')) : navigate('settings-teleprompter')}><ScrollText size={18} />Teleprompter</button><button onClick={() => navigate('help')}><CircleHelp size={18} />Ayuda</button><button onClick={() => navigate('library')}><FolderClosed size={18} />Biblioteca</button></footer>
  </main></>;
}
