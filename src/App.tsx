import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, CircleCheck, X } from 'lucide-react';
import { CURRENT_TUTORIAL_VERSION, type CameraAction, type Config, type Recording, type Settings, type Source } from '../shared/types';
import { RecorderEngine } from './services/recorder';
import { RecorderPanel } from './screens/RecorderPanel';
import { SettingsScreen } from './screens/Settings';
import { SourcePicker } from './screens/SourcePicker';
import { Controller } from './screens/Controller';
import { Library } from './screens/Library';
import { Preview } from './screens/Preview';
import { Help } from './screens/Help';
import { Tutorial } from './components/Tutorial';
import { BrandMark } from './components/ui';
import { mediaError } from './utils/format';
import { transitionWindow } from './utils/window-transition';

export default function App() {
  const [engine] = useState(() => new RecorderEngine());
  const state = useSyncExternalStore(engine.subscribe, engine.snapshot);
  const [config, setConfig] = useState<Config | null>(null), [page, setPage] = useState('home'), [tab, setTab] = useState('audio');
  const [source, setSource] = useState<Source | null>(null), [recording, setRecording] = useState<Recording | null>(null), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const startingAfterPick = useRef(false), exiting = useRef(false), restarting = useRef(false), resumeAfterSettings = useRef(false);
  const report = useCallback((e: unknown) => setError(mediaError(e)), []);
  const active = !['idle', 'finished'].includes(state.phase);
  useEffect(() => { const stopBrowserZoom = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); }; window.addEventListener('wheel', stopBrowserZoom, { passive: false }); return () => window.removeEventListener('wheel', stopBrowserZoom); }, []);
  useEffect(() => window.desktop.onBubbleConfig(settings => { engine.configure(settings); setConfig(current => current ? { ...current, settings } : current); }), [engine]);
  useEffect(() => { if (config) engine.configure(config.settings); }, [config?.settings, engine]);
  useEffect(() => {
    void window.desktop.config().then(c => { setConfig(c); if (c.recovered) setError('Hay borradores recuperados en tu biblioteca. Puedes reproducirlos y guardarlos.'); if (c.firstRun || c.settings.onboardingVersion < CURRENT_TUTORIAL_VERSION) setShowTutorial(true); }).catch(report);
    void window.desktop.sources().then(s => setSource(s.find(x => x.id.startsWith('screen')) || null)).catch(report);
    const refresh = () => void engine.enumerate().catch(report);
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    engine.onFinished = r => { if (!restarting.current) void transitionWindow('preview', () => { setRecording(r); setPage('preview'); }); };
    return () => { navigator.mediaDevices.removeEventListener('devicechange', refresh); engine.dispose(); };
  }, [engine, report]);
  useEffect(() => window.desktop.onNavigate(destination => { if (destination === 'repeat-tutorial') { navigate('home'); setShowTutorial(true); } else navigate(destination); }), [config]);
  const cameraEffectsEnabled = !!config && (config.settings.cameraAutoLight || config.settings.cameraBrightness !== 0 || config.settings.cameraContrast !== 0 || config.settings.cameraTemperature !== 0 || config.settings.cameraSaturation !== 0 || config.settings.cameraBackground !== 'none');
  const settingsKey = config ? JSON.stringify([config.settings.micId, config.settings.cameraId, config.settings.micEnabled, config.settings.cameraEnabled, config.settings.noiseSuppression, config.settings.neuralNoiseSuppression, config.settings.echoCancellation, config.settings.autoGainControl, config.settings.voiceProfile, config.settings.micGain, config.settings.cameraResolution, config.settings.cameraFps, cameraEffectsEnabled]) : '';
  useEffect(() => {
    if (!config || active || state.phase === 'finished') return;
    if (['home', 'settings', 'sources'].includes(page)) void engine.prepare(config.settings); else engine.suspend();
  }, [settingsKey, page, state.phase === 'idle']);
  useEffect(() => {
    if (active) return;
    void window.desktop.bubble(page === 'home' && state.phase === 'idle' && !!state.cameraStream).catch(report);
  }, [active, page, state.phase, state.cameraStream, report]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.dataset.theme = config?.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : config?.settings.theme || 'light';
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [config?.settings.theme]);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(''), 2600); return () => window.clearTimeout(timer); }, [feedback]);
  function navigate(next: string) {
    const destination = next.startsWith('settings-') ? 'settings' : next;
    const layout = active && destination !== 'settings' ? (['preparing', 'countdown'].includes(state.phase) ? 'countdown' : state.zoom > 100 ? 'controller-zoom' : 'controller') : destination;
    void transitionWindow(layout, () => {
      setError(''); engine.clearError();
      if (next.startsWith('settings-')) { setTab(next.split('-')[1]); setPage('settings'); }
      else { if (next === 'settings') setTab('audio'); setPage(next); }
    });
  }
  async function change(patch: Partial<Settings>) {
    if (!config || savingSettings) return; setSavingSettings(true);
    try { setConfig(await window.desktop.setSettings({ ...config.settings, ...patch })); } catch (e) { report(e); } finally { setSavingSettings(false); }
  }
  async function start() {
    if (savingSettings || active || !config) return;
    if (state.phase === 'finished') { engine.reset(); navigate('home'); return; }
    if (!source) { startingAfterPick.current = true; navigate('sources'); return; }
    setError(''); await engine.start(source.id, source.crop, source.displayId);
  }
  const stop = () => { void engine.stop().catch(report); };
  async function restartRecording() {
    if (!config || !source || restarting.current || !['recording', 'paused'].includes(state.phase)) return;
    restarting.current = true; resumeAfterSettings.current = false; setError('');
    try {
      // Keep the finishing/idle states hidden while the current take is
      // discarded. The next visible frame is the new fullscreen countdown.
      await window.desktop.stageLayout('countdown');
      const previous = await engine.stop();
      if (previous) await window.desktop.discardRestart(previous.id);
      setRecording(null); engine.reset();
      void engine.prepare(config.settings);
      await engine.start(source.id, source.crop, source.displayId);
      setFeedback('Grabación reiniciada desde cero.');
    } catch (e) { await transitionWindow('home', () => setPage('home')); report(e); }
    finally { restarting.current = false; }
  }
  function openRecordingSettings() {
    resumeAfterSettings.current = state.phase === 'recording';
    if (resumeAfterSettings.current) engine.pause();
    navigate('settings-audio');
  }
  function closeRecordingSettings() {
    navigate('home');
    if (resumeAfterSettings.current && state.phase === 'paused') engine.pause();
    resumeAfterSettings.current = false;
  }
  useEffect(() => window.desktop.onCommand(command => {
    const cameraShortcut = (action: CameraAction) => void window.desktop.cameraAction(action).then(settings => {
      const label = action === 'small' ? 'Cámara pequeña' : action === 'medium' ? 'Cámara mediana' : action === 'fullscreen' ? (settings.cameraView === 'fullscreen' ? 'Cámara a pantalla completa' : 'Cámara en burbuja') : settings.cameraView === 'image' ? 'Imagen de cámara activada' : 'Cámara en vivo activada';
      setFeedback(`${label}.${state.phase === 'finished' ? ' Se aplicará en la próxima grabación.' : ''}`);
    }).catch(report);
    if (command === 'record') { if (active) stop(); else if (page === 'home') void start(); else { engine.reset(); navigate('home'); } }
    if (command === 'pause') engine.pause();
    if (command === 'mic') { if (active) engine.toggleMic(); else if (config) void change({ micEnabled: !config.settings.micEnabled }); }
    if (command === 'zoom150' && active) engine.setZoom(150);
    if (command === 'zoom200' && active) engine.setZoom(200);
    if (command === 'stop') stop();
    if (command === 'camera') engine.toggleCamera();
    if (command === 'camera-remove') engine.hideCamera();
    if (command === 'camera-small') cameraShortcut('small');
    if (command === 'camera-medium') cameraShortcut('medium');
    if (command === 'camera-fullscreen') cameraShortcut('fullscreen');
    if (command === 'camera-image') cameraShortcut('image');
    if (command === 'stop-exit' && !exiting.current) {
      exiting.current = true;
      void engine.stop().then(async r => { if (r && !r.saved) await window.desktop.save(r.id, r.title); await window.desktop.exitReady(); }).catch(e => { exiting.current = false; report(e); });
    }
  }), [active, page, source, config, savingSettings]);
  async function folder() { try { const root = await window.desktop.chooseFolder(); if (root && config) setConfig({ ...config, root }); } catch (e) { report(e); } }
  const again = () => { setRecording(null); engine.reset(); navigate('home'); };
  const problem = error || state.error || state.warning;
  const message = problem || feedback;
  if (!config) return <div className="app-shell loading"><BrandMark /><p>{error || 'Abriendo Tomixel…'}</p></div>;
  return <div className={`app-shell ${active ? 'is-recording' : ''} ${['preparing', 'countdown'].includes(state.phase) ? 'countdown-shell' : ''}`}>
    {active && page !== 'settings' ? <Controller state={state} pause={() => engine.pause()} mic={() => engine.toggleMic()} camera={() => engine.toggleCamera()} zoom={() => engine.cycleZoom()} stop={stop} restart={restartRecording} settings={openRecordingSettings} skip={() => engine.skipCountdown()} teleprompter={() => void window.desktop.showTeleprompter().catch(report)} teleprompterAvailable={!!config.settings.teleprompterText.trim()} /> : <>
      {page === 'home' && <RecorderPanel config={config} state={state} source={source} change={p => void change(p)} navigate={navigate} start={() => void start()} />}
      {page === 'settings' && <SettingsScreen config={config} state={state} initialTab={tab} change={change} folder={() => void folder()} back={active ? closeRecordingSettings : () => navigate('home')} error={report} />}
      {page === 'sources' && <SourcePicker back={() => { startingAfterPick.current = false; navigate('home'); }} error={report} select={s => { setSource(s); navigate('home'); if (startingAfterPick.current) { startingAfterPick.current = false; void engine.start(s.id, s.crop, s.displayId); } }} />}
      {page === 'library' && <Library back={again} error={report} recovered={config.recovered} open={r => { setRecording(r); navigate('preview'); }} />}
      {page === 'preview' && recording && <Preview recording={recording} update={setRecording} back={() => navigate('library')} again={again} error={report} />}
      {page === 'help' && <Help back={() => navigate('home')} navigate={navigate} tutorial={() => { navigate('home'); setShowTutorial(true); }} />}
    </>}
    {message && <div className={`notice ${!problem ? 'success-notice' : ''} ${active ? 'compact-notice' : ''}`} role={problem ? 'alert' : 'status'}>{problem ? <AlertCircle size={17} /> : <CircleCheck size={17} />}<span>{message}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => { setError(''); setFeedback(''); engine.clearError(); }}><X size={15} /></button></div>}
    {showTutorial && !active && <Tutorial navigate={navigate} finish={() => { navigate('home'); setShowTutorial(false); void change({ onboardingVersion: CURRENT_TUTORIAL_VERSION }); }} />}
  </div>;
}
