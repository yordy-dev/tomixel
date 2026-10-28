import { defaults, type Settings, type Phase, type Recording, type CaptureArea, type CameraEffectPerformance } from '../../shared/types';
import { Compositor, playable } from './compositor';
import { CameraEffectsProcessor, needsCameraEffects } from './camera-effects';
import { mediaError } from '../utils/format';
import { GtcrnWorkletNode, RnnoiseWorkletNode, loadGtcrn, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import gtcrnWorkletPath from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import gtcrnWasmPath from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { recordingBitrate } from './media-quality';
import { transitionWindow } from '../utils/window-transition';
export { recordingBitrate } from './media-quality';

let gtcrnBinaryTask: Promise<ArrayBuffer> | null = null;
let rnnoiseBinaryTask: Promise<ArrayBuffer> | null = null;
function gtcrnBinary() {
  gtcrnBinaryTask ||= loadGtcrn({ url: gtcrnWasmPath }).catch(error => { gtcrnBinaryTask = null; throw error; });
  return gtcrnBinaryTask;
}
function rnnoiseBinary() {
  rnnoiseBinaryTask ||= loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath }).catch(error => { rnnoiseBinaryTask = null; throw error; });
  return rnnoiseBinaryTask;
}

const voiceProfiles = {
  natural: { margin: 5, reduction: 7, highPass: 70, lowMid: -.5, presence: 1.2, threshold: -12, ratio: 2 },
  noisy: { margin: 8, reduction: 15, highPass: 85, lowMid: -1.5, presence: 1.5, threshold: -16, ratio: 2.6 },
  room: { margin: 7, reduction: 11, highPass: 95, lowMid: -2.8, presence: 2.2, threshold: -14, ratio: 2.2 },
  speakers: { margin: 6, reduction: 9, highPass: 80, lowMid: -1, presence: 1.4, threshold: -14, ratio: 2.2 }
} as const;

export interface RecorderSnapshot {
  phase: Phase; elapsed: number; countdown: number; level: number; systemLevel: number; ready: boolean; preparation: string;
  microphones: MediaDeviceInfo[]; cameras: MediaDeviceInfo[]; cameraStream: MediaStream | null; previewStream: MediaStream | null;
  mic: boolean; camera: boolean; denoiserModel: 'none' | 'gtcrn' | 'rnnoise' | 'device'; warning: string; error: string;
  audioSettings: MediaTrackSettings | null; audioCapabilities: MediaTrackCapabilities | null;
  cameraSettings: MediaTrackSettings | null; systemAudioActual: boolean; freeBytes: number; droppedFrames: number; zoom: number;
  cameraEffectPerformance: CameraEffectPerformance;
  noiseFloorDb: number; masterResolution: string; deliveryResolution: string; sharpZoomLimit: number;
}
export class RecorderEngine {
  private value: RecorderSnapshot = { phase: 'idle', elapsed: 0, countdown: 0, level: 0, systemLevel: 0, ready: false, preparation: '', microphones: [], cameras: [], cameraStream: null, previewStream: null, mic: false, camera: false, denoiserModel: 'none', warning: '', error: '', audioSettings: null, audioCapabilities: null, cameraSettings: null, systemAudioActual: false, freeBytes: 0, droppedFrames: 0, zoom: 100, noiseFloorDb: -55, masterResolution: '', deliveryResolution: '', sharpZoomLimit: 100, cameraEffectPerformance: 'off' };
  private listeners = new Set<() => void>();
  private settings = defaults;
  private generation = 0;
  private readyTask: Promise<void> = Promise.resolve();
  private micStream: MediaStream | null = null;
  private camStream: MediaStream | null = null;
  private cameraEffects: CameraEffectsProcessor | null = null;
  private screenStream: MediaStream | null = null;
  private outputStream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private systemAnalyser: AnalyserNode | null = null;
  private denoiser: GtcrnWorkletNode | RnnoiseWorkletNode | null = null;
  private nodes: AudioNode[] = [];
  private compositor: Compositor | null = null;
  private recorder: MediaRecorder | null = null;
  private interval: number | undefined;
  private started = 0;
  private accumulated = 0;
  private runToken = 0;
  private countdownSkipped = false;
  private wakeCountdown: (() => void) | null = null;
  private cursorInterval: number | undefined;
  private storageBusy = false;
  private lastStorageCheck = 0;
  private cameraPreviewVideo: HTMLVideoElement | null = null;
  private cameraPreviewEncoder: VideoEncoder | null = null;
  private cameraPreviewFrame: number | null = null;
  private cameraPreviewForceKey = true;
  private queue: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private writeError = '';
  private completion: Promise<Recording> | null = null;
  private requestedZoom = 100;
  private unsubscribePosition = window.desktop.onPosition(p => { if (this.compositor) this.compositor.position = p; });
  private unsubscribeCameraVideoReady = window.desktop.onCameraVideoReady(() => { this.cameraPreviewForceKey = true; });
  onFinished: ((recording: Recording) => void) | null = null;
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<RecorderSnapshot>) {
    this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn());
  }
  report(error: unknown) { this.update({ error: mediaError(error) }); }
  clearError() { this.update({ error: '', warning: '' }); }
  configure(settings: Settings) { this.settings = settings; this.compositor?.configure(settings); this.cameraEffects?.configure(settings); }
  hideCamera() { if (this.compositor) this.compositor.cameraVisible = false; this.update({ camera: false }); void window.desktop.bubble(false); void this.publish(); }
  skipCountdown() { if (this.value.phase === 'countdown') { this.countdownSkipped = true; this.wakeCountdown?.(); } }
  private async publish() { await window.desktop.status({ phase: this.value.phase, elapsed: this.value.elapsed, mic: this.value.mic, camera: this.value.camera }); }
  async enumerate() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.update({ microphones: devices.filter(d => d.kind === 'audioinput'), cameras: devices.filter(d => d.kind === 'videoinput') });
  }
  prepare(settings: Settings) {
    if (!['idle', 'finished'].includes(this.value.phase)) return this.readyTask;
    this.settings = settings; const generation = ++this.generation;
    this.release(); this.update({ ready: false, mic: false, camera: false, denoiserModel: 'none', cameraStream: null, previewStream: null, audioSettings: null, audioCapabilities: null, cameraSettings: null, warning: '', preparation: 'Comprobando micrófono y cámara…', noiseFloorDb: -55, masterResolution: '', deliveryResolution: '', sharpZoomLimit: 100, cameraEffectPerformance: 'off' });
    this.readyTask = this.acquire(settings, generation); return this.readyTask;
  }
  private async acquire(s: Settings, generation: number) {
    const warnings: string[] = [];
    const supported = navigator.mediaDevices.getSupportedConstraints();
    const audio: MediaTrackConstraints = { deviceId: s.micId ? { exact: s.micId } : undefined, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } };
    for (const key of ['noiseSuppression', 'echoCancellation', 'autoGainControl'] as const) if (supported[key]) {
      if (key === 'noiseSuppression') audio[key] = s.neuralNoiseSuppression ? false : s.noiseSuppression;
      else if (key === 'echoCancellation') audio[key] = s.voiceProfile === 'speakers' ? true : s.echoCancellation;
      else audio[key] = s.autoGainControl;
    }
    const video: MediaTrackConstraints = { deviceId: s.cameraId ? { exact: s.cameraId } : undefined, width: { ideal: s.cameraResolution * 16 / 9 }, height: { ideal: s.cameraResolution }, frameRate: { ideal: s.cameraFps, max: s.cameraFps } };
    const get = async (kind: 'audio' | 'video', constraints: MediaTrackConstraints) => {
      try { return await navigator.mediaDevices.getUserMedia({ [kind]: constraints }); }
      catch (e) {
        if ((e as Error).name === 'OverconstrainedError' && constraints.deviceId) {
          warnings.push('El dispositivo seleccionado cambió. Se usará el predeterminado.');
          try { return await navigator.mediaDevices.getUserMedia({ [kind]: { ...constraints, deviceId: undefined } }); } catch (error) { e = error; }
        }
        warnings.push(`${kind === 'audio' ? 'Micrófono' : 'Cámara'}: ${mediaError(e)}`); return null;
      }
    };
    const [mic, cam] = await Promise.all([s.micEnabled ? get('audio', audio) : null, s.cameraEnabled ? get('video', video) : null]);
    if (generation !== this.generation) { [mic, cam].forEach(stream => stream?.getTracks().forEach(t => t.stop())); return; }
    this.micStream = mic; this.camStream = cam;
    let settingsPreviewCamera = cam;
    if (cam) {
      if (needsCameraEffects(s)) {
        try {
          this.cameraEffects = await CameraEffectsProcessor.create(cam, s, cameraEffectPerformance => this.update({ cameraEffectPerformance }));
          if (generation !== this.generation) { this.cameraEffects.dispose(); this.cameraEffects = null; cam.getTracks().forEach(track => track.stop()); mic?.getTracks().forEach(track => track.stop()); return; }
          settingsPreviewCamera = this.cameraEffects.stream;
        } catch (effectError) {
          this.cameraEffects = null; this.update({ cameraEffectPerformance: 'unavailable' });
          warnings.push(`Los efectos de cámara no pudieron iniciarse: ${mediaError(effectError)}.`);
        }
      }
      // The live bubble always follows the original camera frames. Effects are
      // painted on its 640px relay surface without creating another video stream.
      this.startCameraPreview(cam, this.cameraEffects);
    }
    try {
      if (mic) {
        const context = new AudioContext({ sampleRate: 48000 }); this.context = context;
        const stillCurrent = () => generation === this.generation && this.context === context;
        const source = context.createMediaStreamSource(mic);
        let voiceInput: AudioNode = source;
        let denoiserModel: RecorderSnapshot['denoiserModel'] = 'none';
        if (s.neuralNoiseSuppression) {
          this.update({ preparation: 'Optimizando el procesamiento de voz…' });
          try {
            const wasmBinary = await gtcrnBinary();
            if (!stillCurrent()) return;
            await context.audioWorklet.addModule(gtcrnWorkletPath);
            if (!stillCurrent()) return;
            this.denoiser = new GtcrnWorkletNode(context, { maxChannels: 1, wasmBinary });
            source.connect(this.denoiser); voiceInput = this.denoiser; denoiserModel = 'gtcrn';
          } catch (gtcrnError) {
            try {
              const wasmBinary = await rnnoiseBinary();
              if (!stillCurrent()) return;
              await context.audioWorklet.addModule(rnnoiseWorkletPath);
              if (!stillCurrent()) return;
              this.denoiser = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
              source.connect(this.denoiser); voiceInput = this.denoiser; denoiserModel = 'rnnoise';
              warnings.push(`GTCRN no pudo iniciarse (${mediaError(gtcrnError)}). Se usa RNNoise como respaldo.`);
            } catch (rnnoiseError) {
              warnings.push(`Los modelos de voz no pudieron iniciarse: ${mediaError(gtcrnError)}; ${mediaError(rnnoiseError)}. Se usa la supresión del dispositivo.`);
              await mic.getAudioTracks()[0]?.applyConstraints({ noiseSuppression: true }).catch(() => {});
              denoiserModel = 'device';
            }
          }
        }
        if (!stillCurrent()) return;
        const profile = voiceProfiles[s.voiceProfile];
        let conditionedInput = voiceInput;
        try {
          const voiceExpanderWorkletPath = new URL('./worklets/voice-expander.js', window.location.href).href;
          await context.audioWorklet.addModule(voiceExpanderWorkletPath);
          if (!stillCurrent()) return;
          const expander = new AudioWorkletNode(context, 'voice-expander');
          expander.parameters.get('marginDb')!.value = profile.margin;
          expander.parameters.get('reductionDb')!.value = profile.reduction;
          expander.parameters.get('attackMs')!.value = 12;
          expander.parameters.get('releaseMs')!.value = s.voiceProfile === 'room' ? 340 : 260;
          expander.port.onmessage = event => { if (Number.isFinite(event.data?.noiseFloorDb)) this.update({ noiseFloorDb: Math.round(event.data.noiseFloorDb) }); };
          voiceInput.connect(expander); conditionedInput = expander; this.nodes.push(expander);
        } catch (expanderError) { warnings.push(`El expansor adaptativo no pudo iniciarse: ${mediaError(expanderError)}.`); }
        if (!stillCurrent()) return;
        const highPass = context.createBiquadFilter(); highPass.type = 'highpass'; highPass.frequency.value = profile.highPass; highPass.Q.value = .707;
        const lowMid = context.createBiquadFilter(); lowMid.type = 'peaking'; lowMid.frequency.value = 240; lowMid.Q.value = .8; lowMid.gain.value = profile.lowMid;
        const presence = context.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = .75; presence.gain.value = profile.presence;
        const voiceCompressor = context.createDynamicsCompressor(); voiceCompressor.threshold.value = profile.threshold; voiceCompressor.knee.value = 16; voiceCompressor.ratio.value = profile.ratio; voiceCompressor.attack.value = .01; voiceCompressor.release.value = .2;
        this.gain = context.createGain(); this.gain.gain.value = s.micGain;
        this.analyser = context.createAnalyser(); this.analyser.fftSize = 2048;
        conditionedInput.connect(highPass); highPass.connect(lowMid); lowMid.connect(presence); presence.connect(voiceCompressor); voiceCompressor.connect(this.gain); this.gain.connect(this.analyser);
        this.nodes.push(source, ...(this.denoiser ? [this.denoiser] : []), highPass, lowMid, presence, voiceCompressor, this.gain, this.analyser);
        this.update({ denoiserModel });
        await context.resume();
        if (!stillCurrent()) return;
      }
      const mt = mic?.getAudioTracks()[0], ct = cam?.getVideoTracks()[0];
      for (const [track, name] of [[mt, 'Micrófono'], [ct, 'Cámara']] as const) track?.addEventListener('ended', () => {
        this.update({ warning: `${name} desconectado. La grabación continúa con las demás fuentes.`, ...(name === 'Micrófono' ? { mic: false } : { camera: false, cameraStream: null }) });
        if (name === 'Cámara' && this.compositor) { this.compositor.cameraVisible = false; void window.desktop.bubble(false); }
      }, { once: true });
      this.update({ ready: true, mic: !!mic, camera: !!cam, cameraStream: settingsPreviewCamera, audioSettings: mt?.getSettings() || null, audioCapabilities: mt?.getCapabilities() || null, cameraSettings: ct?.getSettings() || null, warning: warnings.join(' '), preparation: '' });
      this.startMeter(); await this.enumerate();
    } catch (e) { if (generation !== this.generation) return; this.release(); this.report(e); this.update({ ready: true }); }
  }
  private startCameraPreview(stream: MediaStream, effects: CameraEffectsProcessor | null) {
    this.stopCameraPreview();
    if (typeof VideoEncoder === 'undefined') return;
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.autoplay = true; video.srcObject = stream; this.cameraPreviewVideo = video;
    const begin = () => {
      if (this.cameraPreviewVideo !== video || !video.videoWidth || !video.videoHeight) return;
      // The relay consumes raw camera frames and paints effects only at its own
      // small output size. It never waits for a processed MediaStream.
      const width = Math.min(video.videoWidth, 640), height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      const surface = new OffscreenCanvas(width, height), surfaceContext = surface.getContext('2d', { alpha: false }); if (!surfaceContext) return;
      const frameRate = Math.max(1, Math.round(stream.getVideoTracks()[0]?.getSettings().frameRate || this.settings.cameraFps));
      const bitrate = Math.min(10_000_000, Math.max(1_500_000, Math.round(width * height * frameRate * .09)));
      const capturedFrames = new Map<number, number>();
      const encoder = new VideoEncoder({
        output: chunk => {
          const data = new ArrayBuffer(chunk.byteLength); chunk.copyTo(data);
          const capturedAt = capturedFrames.get(chunk.timestamp) || Date.now(); capturedFrames.delete(chunk.timestamp);
          window.desktop.cameraVideoPacket({ data, type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration || undefined, width, height, capturedAt });
        },
        error: () => { if (this.cameraPreviewEncoder === encoder) this.stopCameraPreview(); }
      });
      encoder.configure({ codec: 'vp8', width, height, framerate: frameRate, bitrate, hardwareAcceleration: 'no-preference', latencyMode: 'realtime' });
      this.cameraPreviewEncoder = encoder; this.cameraPreviewForceKey = true;
      const draw = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (this.cameraPreviewVideo !== video || this.cameraPreviewEncoder !== encoder || encoder.state !== 'configured') return;
        // A live preview must never become a delayed queue. If the previous
        // frame is still encoding, skip this one and encode the newest frame
        // as soon as the encoder is free.
        if (encoder.encodeQueueSize === 0) {
          if (effects) effects.drawTo(surfaceContext, video, video.videoWidth, video.videoHeight, 0, 0, width, height, 'relay');
          else surfaceContext.drawImage(video, 0, 0, width, height);
          const timestamp = Math.max(0, Math.round(metadata.mediaTime * 1_000_000)); capturedFrames.set(timestamp, Date.now());
          const frame = new VideoFrame(surface, { timestamp });
          encoder.encode(frame, { keyFrame: this.cameraPreviewForceKey }); frame.close(); this.cameraPreviewForceKey = false;
        } else {
          this.cameraPreviewForceKey = true;
        }
        this.cameraPreviewFrame = video.requestVideoFrameCallback(draw);
      };
      this.cameraPreviewFrame = video.requestVideoFrameCallback(draw);
    };
    video.addEventListener('loadedmetadata', begin, { once: true }); void video.play().catch(() => {});
  }
  private stopCameraPreview() {
    if (this.cameraPreviewVideo && this.cameraPreviewFrame !== null) this.cameraPreviewVideo.cancelVideoFrameCallback(this.cameraPreviewFrame);
    this.cameraPreviewFrame = null;
    if (this.cameraPreviewEncoder && this.cameraPreviewEncoder.state !== 'closed') this.cameraPreviewEncoder.close();
    this.cameraPreviewEncoder = null;
    if (this.cameraPreviewVideo) { this.cameraPreviewVideo.pause(); this.cameraPreviewVideo.srcObject = null; }
    this.cameraPreviewVideo = null; this.cameraPreviewForceKey = true;
  }
  private startMeter() {
    clearInterval(this.interval);
    const samples = new Float32Array(2048);
    this.interval = window.setInterval(() => {
      let level = 0, systemLevel = 0;
      if (this.analyser) {
        this.analyser.getFloatTimeDomainData(samples);
        let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        level = Math.min(1, Math.max(peak, this.value.level * .72));
      }
      if (this.systemAnalyser) {
        this.systemAnalyser.getFloatTimeDomainData(samples);
        let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        systemLevel = Math.min(1, Math.max(peak, this.value.systemLevel * .72));
      }
      const elapsed = this.accumulated + (this.value.phase === 'recording' ? (performance.now() - this.started) / 1000 : 0);
      const droppedFrames = this.compositor?.droppedFrames || 0;
      this.update({ level, systemLevel, droppedFrames, ...(['recording', 'paused'].includes(this.value.phase) ? { elapsed } : {}) });
      if (this.value.phase === 'recording' && Date.now() - this.lastStorageCheck > 10000 && !this.storageBusy) {
        this.lastStorageCheck = Date.now(); this.storageBusy = true;
        void window.desktop.storageStats().then(stats => {
          this.update({ freeBytes: stats.freeBytes });
          if (stats.freeBytes < 256 * 1024 * 1024 && this.recorder?.state !== 'inactive') { this.update({ warning: 'Quedan menos de 256 MB. Se está finalizando para proteger el video.' }); void this.stop().catch(e => this.report(e)); }
        }).catch(e => this.update({ warning: `No se pudo comprobar el espacio libre: ${mediaError(e)}` })).finally(() => { this.storageBusy = false; });
      }
    }, 100);
  }
  async start(sourceId: string | null, crop?: CaptureArea, displayId = '') {
    if (!['idle', 'finished'].includes(this.value.phase)) return;
    const token = ++this.runToken;
    let pendingId: string | null = null;
    this.requestedZoom = 100;
    await transitionWindow('countdown', () => this.update({ phase: 'preparing', elapsed: 0, error: '', systemAudioActual: false, droppedFrames: 0, zoom: 100 }));
    await this.publish();
    try {
      if (crop && (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width < .05 || crop.height < .05 || crop.x + crop.width > 1.001 || crop.y + crop.height > 1.001)) throw new Error('El área seleccionada no es válida. Vuelve a marcarla.');
      await window.desktop.bubble(false);
      const disk = await window.desktop.storageStats();
      this.update({ freeBytes: disk.freeBytes });
      if (disk.freeBytes < 512 * 1024 * 1024) throw new Error('No hay espacio suficiente para grabar. Libera al menos 512 MB.');
      if (disk.freeBytes < 2 * 1024 * 1024 * 1024) this.update({ warning: 'Quedan menos de 2 GB libres. Una grabación larga podría detenerse antes de tiempo.' });
      await this.readyTask;
      if (token !== this.runToken) return;
      if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder no está disponible.');
      if (!sourceId) throw new Error('Selecciona una pantalla o ventana.');
      await window.desktop.selectSource(sourceId, this.settings.systemAudio);
      // Keep the highest source detail available. The MP4 delivery resolution is
      // applied only during export, so zoom never starts from an early 1080p copy.
      const videoConstraints: MediaTrackConstraints = { frameRate: { ideal: this.settings.screenFps, max: this.settings.screenFps }, width: { ideal: 7680 }, height: { ideal: 4320 } };
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: this.settings.systemAudio });
      } catch (e) {
        if (!this.settings.systemAudio) throw e;
        await window.desktop.selectSource(sourceId, false);
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
        this.update({ warning: 'Audio del sistema no disponible en esta captura. Se grabarán pantalla y micrófono.' });
      }
      if (token !== this.runToken) { this.release(); return; }
      const hasAudio = this.screenStream.getAudioTracks().length > 0;
      this.update({ systemAudioActual: hasAudio });
      if (this.settings.systemAudio && !hasAudio) this.update({ warning: 'Windows no entregó una pista de audio del sistema. La grabación continúa sin ella.' });
      this.screenStream.getVideoTracks()[0].addEventListener('ended', () => { void this.stop().catch(e => this.report(e)); }, { once: true });
      // Keep the native camera track in the recording path. The compositor
      // applies effects directly to the destination frame, preserving timing
      // and the camera's real resolution.
      const [screenVideo, cameraVideo] = await Promise.all([this.screenStream ? playable(this.screenStream) : null, this.camStream ? playable(this.camStream) : null]);
      if (token !== this.runToken) { [screenVideo, cameraVideo].forEach(v => { if (v) { v.pause(); v.srcObject = null; } }); return; }
      const actualCameraFps = Math.max(1, Math.round(this.camStream?.getVideoTracks()[0]?.getSettings().frameRate || this.settings.cameraFps));
      const cameraParticipates = !!cameraVideo && this.settings.cameraView !== 'image';
      // Do not manufacture 60 canvas frames from a webcam that only delivers
      // 30. That duplicated cadence made the realtime encoder accumulate video
      // behind the microphone and divided the available detail across copies.
      const outputFps = cameraParticipates ? Math.min(this.settings.screenFps, actualCameraFps) : this.settings.screenFps;
      const compositorSettings = outputFps === this.settings.screenFps ? this.settings : { ...this.settings, screenFps: outputFps };
      this.compositor = new Compositor(screenVideo, cameraVideo, compositorSettings, crop, sourceId.startsWith('screen:'), this.cameraEffects);
      const master = this.compositor.masterResolution, delivery = this.compositor.deliveryResolution;
      this.update({ masterResolution: `${master.width}×${master.height}`, deliveryResolution: `${delivery.width}×${delivery.height}`, sharpZoomLimit: this.compositor.sharpZoom });
      this.compositor.updateCursor(await window.desktop.cursor(displayId));
      {
        let inFlight = false;
        this.cursorInterval = window.setInterval(() => {
          if (inFlight || !this.compositor) return; inFlight = true;
          void window.desktop.cursor(displayId).then(cursor => {
            this.compositor?.updateCursor(cursor);
            const zoom = this.compositor?.zoom || 100; if (zoom !== this.value.zoom) this.publishZoom(zoom);
          }).catch(() => {}).finally(() => { inFlight = false; });
        }, outputFps === 60 ? 16 : 24);
      }
      const output = new MediaStream(this.compositor.stream.getVideoTracks());
      const outputTrack = output.getVideoTracks()[0];
      if (outputTrack) outputTrack.contentHint = outputFps >= 50 ? 'motion' : 'detail';
      this.outputStream = output;
      this.update({ previewStream: this.compositor.stream });
      if (this.micStream || this.screenStream?.getAudioTracks().length) {
        this.context ||= new AudioContext(); await this.context.resume();
        const destination = this.context.createMediaStreamDestination();
        const limiter = this.context.createDynamicsCompressor(); limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .1;
        const mix = this.context.createGain(); mix.gain.value = 1;
        this.gain?.connect(mix);
        if (this.screenStream?.getAudioTracks().length) {
          const source = this.context.createMediaStreamSource(new MediaStream(this.screenStream.getAudioTracks()));
          const systemGain = this.context.createGain(); systemGain.gain.value = this.settings.systemGain;
          this.systemAnalyser = this.context.createAnalyser(); this.systemAnalyser.fftSize = 2048;
          source.connect(systemGain); systemGain.connect(this.systemAnalyser); this.systemAnalyser.connect(mix); this.nodes.push(source, systemGain, this.systemAnalyser);
        }
        mix.connect(limiter); limiter.connect(destination); this.nodes.push(mix, limiter, destination);
        destination.stream.getAudioTracks().forEach(t => output.addTrack(t));
      }
      // VP8 has a lower realtime encoding cost in Chromium. Prefer it for the
      // live canvas so selection, cursor motion and zoom cannot build a VP9
      // encoding queue behind the audio track. The high bitrate preserves text.
      const codecs = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
      const mime = codecs.find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('Ningún códec WebM compatible está disponible.');
      const dimensions = output.getVideoTracks()[0]?.getSettings();
      const width = dimensions?.width || master.width, height = dimensions?.height || master.height;
      this.recorder = new MediaRecorder(output, { mimeType: mime, videoBitsPerSecond: recordingBitrate(width, height, this.settings.screenFps, this.settings.quality), audioBitsPerSecond: 192000 });
      this.update({ phase: 'countdown', countdown: this.settings.countdown }); await this.publish();
      this.countdownSkipped = false;
      for (let n = this.settings.countdown; n > 0; n--) {
        this.update({ countdown: n });
        await new Promise<void>(resolve => { const timer = setTimeout(() => { this.wakeCountdown = null; resolve(); }, 1000); this.wakeCountdown = () => { clearTimeout(timer); this.wakeCountdown = null; resolve(); }; });
        if (token !== this.runToken) return;
        if (this.countdownSkipped) break;
      }
      const id = await window.desktop.begin(); pendingId = id;
      if (token !== this.runToken) { await window.desktop.abort(id); return; }
      this.queue = Promise.resolve(); this.pendingBytes = 0; this.writeError = '';
      const recorder = this.recorder;
      this.completion = new Promise<Recording>((resolve, reject) => {
        recorder.ondataavailable = event => {
          if (!event.data.size) return;
          this.pendingBytes += event.data.size;
          this.queue = this.queue.then(async () => {
            // Split unusually large chunks; IPC buffers stay bounded.
            for (let offset = 0; offset < event.data.size; offset += 4 * 1024 * 1024) await window.desktop.append(id, await event.data.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer());
          }).catch(e => { this.writeError = `Error al escribir: ${mediaError(e)}. Se conservarán los fragmentos recibidos.`; this.update({ error: this.writeError }); if (recorder.state !== 'inactive') void this.stop().catch(() => {}); }).finally(() => { this.pendingBytes -= event.data.size; });
          if (this.pendingBytes > 32 * 1024 * 1024 && recorder.state !== 'inactive') { this.update({ warning: 'El disco no puede mantener el ritmo. Se está finalizando para proteger la grabación.' }); void this.stop().catch(() => {}); }
        };
        recorder.onerror = event => { this.report((event as Event & { error?: Error }).error || new Error('La grabación falló.')); if (recorder.state !== 'inactive') void this.stop().catch(() => {}); };
        recorder.onstop = async () => {
          if (this.value.phase === 'recording') this.accumulated += (performance.now() - this.started) / 1000;
          const elapsed = this.accumulated;
          this.update({ phase: 'finishing', elapsed }); await this.publish();
          this.release(); await window.desktop.bubble(false);
          try {
            await this.queue;
            let recording = await window.desktop.finish(id, elapsed);
            if (this.settings.autoSave && !this.writeError) {
              try { recording = await window.desktop.save(id, recording.title); } catch (e) { this.report(e); }
            }
            this.requestedZoom = 100;
            this.update({ phase: 'finished', elapsed, ready: false, cameraStream: null, previewStream: null, mic: false, camera: false, level: 0, zoom: 100 });
            this.onFinished?.(recording); await this.publish(); resolve(recording);
          } catch (e) { this.report(e); this.update({ phase: 'finished', ready: false }); await this.publish(); reject(e); }
        };
      });
      // Attach rejection handling immediately for hardware-triggered stops.
      void this.completion.catch(e => this.report(e));
      this.compositor?.resetFrameHealth(); recorder.start(1000); pendingId = null; this.started = performance.now(); this.accumulated = 0;
      await transitionWindow('controller', () => { this.update({ phase: 'recording', countdown: 0 }); this.startMeter(); });
      await this.publish();
      if (this.camStream) await window.desktop.bubble(true);
    } catch (e) {
      if (pendingId) await window.desktop.abort(pendingId).catch(() => {});
      this.release(); this.report(e); this.requestedZoom = 100;
      await transitionWindow('home', () => this.update({ phase: 'idle', ready: false, cameraStream: null, previewStream: null, mic: false, camera: false, zoom: 100 }));
      await this.publish();
    }
  }
  pause() {
    if (this.recorder?.state === 'recording') { this.recorder.pause(); this.accumulated += (performance.now() - this.started) / 1000; this.update({ phase: 'paused', elapsed: this.accumulated }); }
    else if (this.recorder?.state === 'paused') { this.recorder.resume(); this.started = performance.now(); this.update({ phase: 'recording' }); }
    void this.publish();
  }
  toggleMic() { if (!this.micStream) return; const on = !this.value.mic; this.micStream.getAudioTracks().forEach(t => { t.enabled = on; }); this.update({ mic: on }); void this.publish(); }
  toggleCamera() { if (!this.camStream || !this.compositor) return; const on = !this.value.camera; this.compositor.cameraVisible = on; this.update({ camera: on }); if (this.screenStream) void window.desktop.bubble(on); void this.publish(); }
  private publishZoom(zoom: number) {
    if (zoom === this.requestedZoom) return;
    const previousLayout = this.requestedZoom > 100 ? 'controller-zoom' : 'controller';
    const nextLayout = zoom > 100 ? 'controller-zoom' : 'controller';
    this.requestedZoom = zoom;
    const limit = this.compositor?.sharpZoom || 100;
    const zoomWarning = `Esta fuente conserva nitidez real hasta ${limit}%. Por encima de ese nivel el zoom ampliará píxeles existentes.`;
    const render = () => this.update({ zoom, sharpZoomLimit: limit, warning: zoom > limit ? zoomWarning : this.value.warning.startsWith('Esta fuente conserva nitidez real') ? '' : this.value.warning });
    if (previousLayout === nextLayout) render();
    else void transitionWindow(nextLayout, render);
  }
  cycleZoom() { if (!this.compositor) return; this.publishZoom(this.compositor.cycleZoom()); }
  setZoom(percent: 150 | 200) { if (!this.compositor) return; this.publishZoom(this.compositor.toggleZoom(percent)); }
  async stop(): Promise<Recording | null> {
    if (['preparing', 'countdown'].includes(this.value.phase)) {
      this.runToken++; this.wakeCountdown?.(); this.generation++; this.release(); this.requestedZoom = 100;
      await transitionWindow('home', () => this.update({ phase: 'idle', ready: false, countdown: 0, cameraStream: null, previewStream: null, mic: false, camera: false, zoom: 100 }));
      await this.publish(); return null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      if (this.value.phase === 'recording') this.accumulated += (performance.now() - this.started) / 1000;
      this.update({ phase: 'finishing', elapsed: this.accumulated }); await this.publish(); this.recorder.stop();
    }
    return this.completion;
  }
  reset() { this.completion = null; this.accumulated = 0; this.requestedZoom = 100; this.update({ phase: 'idle', elapsed: 0, ready: false, previewStream: null, zoom: 100, error: '' }); void this.publish(); }
  suspend() { this.generation++; this.release(); this.requestedZoom = 100; this.update({ ready: false, cameraStream: null, previewStream: null, mic: false, camera: false, level: 0, zoom: 100 }); }
  private release() {
    clearInterval(this.interval); this.interval = undefined;
    this.compositor?.dispose(); this.compositor = null; this.stopCameraPreview(); this.cameraEffects?.dispose(); this.cameraEffects = null;
    for (const stream of [this.micStream, this.camStream, this.screenStream, this.outputStream]) stream?.getTracks().forEach(t => t.stop());
    this.micStream = this.camStream = this.screenStream = this.outputStream = null; this.recorder = null;
    this.nodes.forEach(node => node.disconnect()); this.nodes = [];
    this.denoiser?.destroy(); this.denoiser = null;
    if (this.context) void this.context.close().catch(() => {}); this.context = null; this.gain = null; this.analyser = null; this.systemAnalyser = null;
    clearInterval(this.cursorInterval); this.cursorInterval = undefined; this.lastStorageCheck = 0; this.storageBusy = false;
  }
  dispose() { this.generation++; this.runToken++; this.release(); this.unsubscribePosition(); this.unsubscribeCameraVideoReady(); }
}
