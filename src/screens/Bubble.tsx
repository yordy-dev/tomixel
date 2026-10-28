import { useEffect, useRef, useState } from 'react';
import { Circle, Maximize, MoreHorizontal, UserRound, X } from 'lucide-react';
import type { CameraAction, CameraVideoPacket, Settings } from '../../shared/types';

function CameraVideoPreview({ mirror = true, circular = true, ready }: { mirror?: boolean; circular?: boolean; ready: (state: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || typeof VideoDecoder === 'undefined') { ready('unsupported'); return; }
    let configured = '', stopped = false, waitingForKeyframe = true;
    const decoder = new VideoDecoder({ output: frame => {
      if (stopped) { frame.close(); return; }
      const scale = Math.min(devicePixelRatio || 1, 2), width = Math.max(1, Math.round(canvas.clientWidth * scale)), height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext('2d', { alpha: true });
      if (context) {
        const sourceScale = Math.max(width / frame.displayWidth, height / frame.displayHeight), sourceWidth = width / sourceScale, sourceHeight = height / sourceScale;
        const sourceX = (frame.displayWidth - sourceWidth) / 2, sourceY = (frame.displayHeight - sourceHeight) / 2;
        context.clearRect(0, 0, width, height); context.save(); if (mirror) { context.translate(width, 0); context.scale(-1, 1); }
        context.drawImage(frame, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height); context.restore(); ready('playing');
      }
      frame.close();
    }, error: decoderError => ready(`error:${decoderError.name}`) });
    const receive = (packet: CameraVideoPacket) => {
      const next = `${packet.width}x${packet.height}`;
      const latency = Math.max(0, Date.now() - packet.capturedAt); canvas.dataset.cameraRelayLatencyMs = String(latency);
      if (latency > 350 && packet.type === 'delta') {
        if (decoder.state !== 'unconfigured') decoder.reset(); configured = ''; waitingForKeyframe = true; window.desktop.cameraVideoReady(); ready('catching-up'); return;
      }
      if (decoder.decodeQueueSize > 1) {
        decoder.reset(); configured = ''; waitingForKeyframe = true; window.desktop.cameraVideoReady(); ready('catching-up'); return;
      }
      if (waitingForKeyframe && packet.type !== 'key') return;
      if (configured !== next) { if (decoder.state !== 'unconfigured') decoder.reset(); decoder.configure({ codec: 'vp8', codedWidth: packet.width, codedHeight: packet.height, hardwareAcceleration: 'no-preference', optimizeForLatency: true }); configured = next; }
      try { decoder.decode(new EncodedVideoChunk({ type: packet.type, timestamp: packet.timestamp, duration: packet.duration, data: packet.data })); waitingForKeyframe = false; } catch { waitingForKeyframe = true; window.desktop.cameraVideoReady(); ready('waiting-keyframe'); }
    };
    const unsubscribe = window.desktop.onCameraVideoPacket(receive); window.desktop.cameraVideoReady(); ready('connecting');
    return () => { stopped = true; unsubscribe(); if (decoder.state !== 'closed') decoder.close(); };
  }, [mirror, circular, ready]);
  return <canvas ref={canvasRef} aria-label={circular ? 'Vista previa circular de la cámara' : 'Vista previa rectangular de la cámara'} />;
}

export function Bubble() {
  const [settings, setSettings] = useState<Settings | null>(null), [videoState, setVideoState] = useState('new');
  const [error, setError] = useState(''), [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { void window.desktop.bubbleConfig().then(setSettings); return window.desktop.onBubbleConfig(setSettings); }, []);
  const imageMode = settings?.cameraView === 'image', fullscreen = settings?.cameraView === 'fullscreen';
  async function action(action: CameraAction) {
    if (busy) return; setBusy(true); setError('');
    try { setSettings(await window.desktop.cameraAction(action)); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); } finally { setBusy(false); }
  }
  return <div className={`bubble-surface ${fullscreen ? 'fullscreen-camera' : ''}`} data-camera-video-state={videoState} onMouseLeave={() => { setExpanded(false); setError(''); }}>
    <div className="bubble-visual" title={fullscreen ? 'Cámara a pantalla completa' : 'Arrastra para mover la cámara'}
      onPointerDown={e => { if (e.button !== 0 || fullscreen) return; drag.current = { x: e.screenX, y: e.screenY }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current) return; const delta = { x: e.screenX - drag.current.x, y: e.screenY - drag.current.y }; drag.current = { x: e.screenX, y: e.screenY }; void window.desktop.moveBubble(delta).catch(() => {}); }}
      onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onLostPointerCapture={() => { drag.current = null; }}>
      {imageMode && settings?.cameraImage ? <img src={settings.cameraImage} alt="Imagen de cámara elegida" draggable={false} /> : <CameraVideoPreview mirror={settings?.mirrorPreview} circular={!fullscreen} ready={setVideoState} />}
    </div>
    <div className="bubble-controls" onMouseEnter={() => setExpanded(true)}>
      {!expanded ? <button className="bubble-more" aria-label="Opciones de cámara" onFocus={() => setExpanded(true)} onClick={() => setExpanded(true)}><MoreHorizontal size={21} /></button> : <div className="bubble-menu" role="toolbar" aria-label="Opciones de cámara">
        <button aria-label="Remover cámara" title="Remover cámara" disabled={busy} onClick={() => void action('remove')}><X size={17} /></button>
        <button aria-label="Cámara pequeña" title="Pequeña" aria-pressed={settings?.size === 'small' && !fullscreen} disabled={busy} onClick={() => void action('small')}><Circle size={10} fill="currentColor" /></button>
        <button aria-label="Cámara mediana" title="Mediana" aria-pressed={settings?.size === 'medium' && !fullscreen} disabled={busy} onClick={() => void action('medium')}><Circle size={15} fill="currentColor" /></button>
        <button aria-label="Cámara a pantalla completa" title={fullscreen ? 'Volver a burbuja' : 'Pantalla completa'} aria-pressed={fullscreen} disabled={busy} onClick={() => void action('fullscreen')}><Maximize size={17} /></button>
        <button aria-label={imageMode ? 'Volver a cámara en vivo' : 'Usar imagen de cámara'} title={settings?.cameraImage ? (imageMode ? 'Volver a cámara en vivo' : 'Usar imagen') : 'Carga una imagen en Ajustes → Cámara'} aria-pressed={imageMode} disabled={busy} onClick={() => void action('image')}><UserRound size={17} /></button>
      </div>}
    </div>
    {fullscreen && settings && <div className="fullscreen-resize-zone">
      <div className="fullscreen-resizer">
        <output>{settings.fullscreenScale}%</output>
        <input type="range" min="10" max="100" step="10" value={settings.fullscreenScale} aria-label="Tamaño de cámara en pantalla completa"
          onChange={e => { const value = Number(e.target.value); setSettings(current => current ? { ...current, fullscreenScale: value } : current); void window.desktop.setFullscreenScale(value).then(setSettings).catch(error => setError((error as Error).message)); }} />
      </div>
    </div>}
    {error && <div className="bubble-error" role="alert">{error}</div>}
  </div>;
}
