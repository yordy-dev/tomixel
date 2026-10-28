import type { CameraEffectPerformance, Settings } from '../../shared/types';

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};
type ManualCanvasTrack = CanvasCaptureMediaStreamTrack & { requestFrame?: () => void };
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Scratch = { person: HTMLCanvasElement; background: HTMLCanvasElement };
type MaskMessage = { type: 'mask'; data: ArrayBuffer; width: number; height: number; processingMs: number } | { type: 'ready' | 'skipped' } | { type: 'error'; message: string };

export function cameraFilter(settings: Pick<Settings, 'cameraBrightness' | 'cameraContrast' | 'cameraSaturation'>, automaticBrightness = 0) {
  const brightness = Math.max(50, Math.min(175, 100 + settings.cameraBrightness + automaticBrightness));
  const contrast = Math.max(50, Math.min(150, 100 + settings.cameraContrast));
  const saturation = Math.max(50, Math.min(160, 100 + settings.cameraSaturation));
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
}

export function needsCameraEffects(settings: Pick<Settings, 'cameraAutoLight' | 'cameraBrightness' | 'cameraContrast' | 'cameraTemperature' | 'cameraSaturation' | 'cameraBackground'>) {
  return settings.cameraAutoLight || settings.cameraBrightness !== 0 || settings.cameraContrast !== 0 || settings.cameraTemperature !== 0 || settings.cameraSaturation !== 0 || settings.cameraBackground !== 'none';
}

function cover(context: RenderContext, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number, padding = 0) {
  if (!sourceWidth || !sourceHeight || width <= 0 || height <= 0) return;
  const scale = Math.max((width + padding * 2) / sourceWidth, (height + padding * 2) / sourceHeight);
  const sw = (width + padding * 2) / scale, sh = (height + padding * 2) / scale;
  context.drawImage(source, (sourceWidth - sw) / 2, (sourceHeight - sh) / 2, sw, sh, x - padding, y - padding, width + padding * 2, height + padding * 2);
}

/** Keeps effects outside the raw camera track used by recording and preview. */
export class CameraEffectsProcessor {
  readonly canvas = document.createElement('canvas');
  readonly stream: MediaStream;
  private readonly context: CanvasRenderingContext2D;
  private readonly captureTrack: ManualCanvasTrack;
  private readonly video: FrameVideo;
  private readonly maskCanvas = document.createElement('canvas');
  private readonly analysisCanvas = document.createElement('canvas');
  private readonly scratch = new Map<string, Scratch>();
  private worker: Worker | null = null;
  private workerReady = false;
  private segmentationPending = false;
  private mask: Float32Array | null = null;
  private maskWidth = 0;
  private maskHeight = 0;
  private maskDirty = false;
  private frameHandle: number | null = null;
  private fallbackTimer: number | undefined;
  private lastSegmentationAt = 0;
  private lastAnalysisAt = 0;
  private automaticBrightness = 0;
  private backgroundImage: HTMLImageElement | null = null;
  private backgroundSource = '';
  private settings: Settings;
  private disposed = false;
  private performance: CameraEffectPerformance = 'off';
  private processingSamples: number[] = [];

  private constructor(stream: MediaStream, settings: Settings, private onPerformance: (value: CameraEffectPerformance) => void) {
    this.settings = settings;
    this.video = document.createElement('video') as FrameVideo;
    this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true; this.video.srcObject = stream;
    this.context = this.canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    // Only Settings consumes this small processed stream. The recording and
    // floating bubble draw directly from the original camera track.
    this.stream = this.canvas.captureStream(0);
    this.captureTrack = this.stream.getVideoTracks()[0] as ManualCanvasTrack;
  }

  static async create(stream: MediaStream, settings: Settings, onPerformance: (value: CameraEffectPerformance) => void) {
    const processor = new CameraEffectsProcessor(stream, settings, onPerformance);
    await processor.video.play();
    if (!processor.video.videoWidth || !processor.video.videoHeight) await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('La cámara no entregó dimensiones de video.')), 4000);
      processor.video.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });
    processor.analysisCanvas.width = 64; processor.analysisCanvas.height = 36;
    processor.configure(settings);
    processor.drawPreview(performance.now());
    processor.schedule();
    return processor;
  }

  configure(settings: Settings) {
    this.settings = settings;
    const sourceWidth = this.video.videoWidth || 16, sourceHeight = this.video.videoHeight || 9;
    const width = Math.min(sourceWidth, 640), height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    if (settings.cameraBackgroundImage !== this.backgroundSource) {
      this.backgroundSource = settings.cameraBackgroundImage;
      this.backgroundImage = settings.cameraBackgroundImage ? new Image() : null;
      if (this.backgroundImage) this.backgroundImage.src = settings.cameraBackgroundImage;
    }
    if (settings.cameraBackground === 'none') this.stopSegmentation();
    else this.startSegmentation();
  }

  private setPerformance(value: CameraEffectPerformance) {
    if (this.performance === value) return;
    this.performance = value; this.onPerformance(value);
  }

  private startSegmentation() {
    if (this.worker || this.disposed) return;
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') { this.setPerformance('unavailable'); return; }
    this.setPerformance('loading');
    this.worker = new Worker(new URL('../workers/camera-segmentation.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<MaskMessage>) => {
      const message = event.data;
      if (message.type === 'ready') { this.workerReady = true; this.segmentationPending = false; return; }
      if (message.type === 'skipped') { this.segmentationPending = false; return; }
      if (message.type === 'error') { this.segmentationPending = false; console.warn('Camera background processor:', message.message); this.setPerformance('unavailable'); return; }
      if (message.type !== 'mask') return;
      this.mask = new Float32Array(message.data); this.maskWidth = message.width; this.maskHeight = message.height; this.maskDirty = true; this.segmentationPending = false;
      this.processingSamples.push(message.processingMs); if (this.processingSamples.length > 12) this.processingSamples.shift();
      const average = this.processingSamples.reduce((sum, value) => sum + value, 0) / this.processingSamples.length;
      this.setPerformance(average > 85 ? 'limited' : 'optimal');
    };
    this.worker.onerror = event => { this.segmentationPending = false; console.warn('Camera background worker:', event.message); this.setPerformance('unavailable'); };
    const base = new URL('./mediapipe/wasm/', window.location.href).href;
    const model = new URL('./mediapipe/models/selfie_segmenter.tflite', window.location.href).href;
    this.worker.postMessage({ type: 'init', wasmBase: base, modelUrl: model });
  }

  private stopSegmentation() {
    this.worker?.postMessage({ type: 'close' }); this.worker?.terminate(); this.worker = null; this.workerReady = false; this.segmentationPending = false;
    this.mask = null; this.maskDirty = false; this.processingSamples = []; this.setPerformance('off');
  }

  private requestMask(now: number) {
    if (!this.worker || !this.workerReady || this.segmentationPending || now - this.lastSegmentationAt < 90) return;
    this.segmentationPending = true; this.lastSegmentationAt = now;
    void createImageBitmap(this.video, { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'low' }).then(bitmap => {
      if (!this.worker || this.disposed) { bitmap.close(); this.segmentationPending = false; return; }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
    }).catch(() => { this.segmentationPending = false; this.setPerformance('unavailable'); });
  }

  private updateAutomaticLight(now: number) {
    if (!this.settings.cameraAutoLight) { this.automaticBrightness += (0 - this.automaticBrightness) * .12; return; }
    if (now - this.lastAnalysisAt < 450) return;
    this.lastAnalysisAt = now;
    const context = this.analysisCanvas.getContext('2d', { willReadFrequently: true }); if (!context) return;
    context.drawImage(this.video, 0, 0, this.analysisCanvas.width, this.analysisCanvas.height);
    const pixels = context.getImageData(0, 0, this.analysisCanvas.width, this.analysisCanvas.height).data;
    let luminance = 0;
    for (let index = 0; index < pixels.length; index += 4) luminance += pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722;
    const average = luminance / (pixels.length / 4);
    const target = Math.max(-12, Math.min(35, (112 - average) * .34));
    this.automaticBrightness += (target - this.automaticBrightness) * .35;
  }

  private applyTemperature(context: RenderContext, x: number, y: number, width: number, height: number) {
    const value = this.settings.cameraTemperature; if (!value) return;
    context.save(); context.globalCompositeOperation = 'source-atop';
    context.fillStyle = value > 0 ? `rgba(255,145,55,${Math.abs(value) / 500})` : `rgba(75,145,255,${Math.abs(value) / 500})`;
    context.fillRect(x, y, width, height); context.restore();
  }

  private drawCamera(context: RenderContext, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number, blur = 0) {
    context.save();
    context.filter = `${cameraFilter(this.settings, this.automaticBrightness)}${blur ? ` blur(${blur}px)` : ''}`;
    cover(context, source, sourceWidth, sourceHeight, x, y, width, height, blur ? blur * 2 : 0);
    context.restore(); this.applyTemperature(context, x, y, width, height);
  }

  private updateMaskCanvas() {
    if (!this.mask || !this.maskWidth || !this.maskHeight) return false;
    if (!this.maskDirty) return true;
    if (this.maskCanvas.width !== this.maskWidth || this.maskCanvas.height !== this.maskHeight) { this.maskCanvas.width = this.maskWidth; this.maskCanvas.height = this.maskHeight; }
    const context = this.maskCanvas.getContext('2d'); if (!context) return false;
    const image = context.createImageData(this.maskWidth, this.maskHeight);
    for (let index = 0; index < this.mask.length; index++) {
      const alpha = Math.max(0, Math.min(255, Math.round((this.mask[index] - .08) / .84 * 255)));
      const pixel = index * 4; image.data[pixel] = image.data[pixel + 1] = image.data[pixel + 2] = 255; image.data[pixel + 3] = alpha;
    }
    context.putImageData(image, 0, 0); this.maskDirty = false; return true;
  }

  private getScratch(key: string, width: number, height: number) {
    let value = this.scratch.get(key);
    if (!value) { value = { person: document.createElement('canvas'), background: document.createElement('canvas') }; this.scratch.set(key, value); }
    if (value.person.width !== width || value.person.height !== height) { value.person.width = width; value.person.height = height; }
    const backgroundWidth = Math.min(width, 640), backgroundHeight = Math.max(1, Math.round(backgroundWidth * height / width));
    if (value.background.width !== backgroundWidth || value.background.height !== backgroundHeight) { value.background.width = backgroundWidth; value.background.height = backgroundHeight; }
    return value;
  }

  drawTo(context: RenderContext, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number, target = 'default') {
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    const background = this.settings.cameraBackground;
    if (background === 'none' || !this.updateMaskCanvas()) { this.drawCamera(context, source, sourceWidth, sourceHeight, x, y, width, height); return; }

    const scratch = this.getScratch(target, width, height);
    if (background === 'image' && this.backgroundImage?.complete && this.backgroundImage.naturalWidth) {
      cover(context, this.backgroundImage, this.backgroundImage.naturalWidth, this.backgroundImage.naturalHeight, x, y, width, height);
    } else {
      const reduced = scratch.background.getContext('2d', { alpha: false, desynchronized: true })!;
      reduced.clearRect(0, 0, scratch.background.width, scratch.background.height);
      const blur = background === 'blur-strong' ? 22 : 11;
      this.drawCamera(reduced, source, sourceWidth, sourceHeight, 0, 0, scratch.background.width, scratch.background.height, Math.max(3, blur * scratch.background.width / width));
      context.drawImage(scratch.background, x, y, width, height);
    }

    const person = scratch.person.getContext('2d', { alpha: true, desynchronized: true })!;
    person.clearRect(0, 0, width, height);
    this.drawCamera(person, source, sourceWidth, sourceHeight, 0, 0, width, height);
    person.save(); person.globalCompositeOperation = 'destination-in'; person.filter = 'blur(2px)'; person.drawImage(this.maskCanvas, 0, 0, width, height); person.restore();
    context.drawImage(scratch.person, x, y, width, height);
  }

  private drawPreview(now: number) {
    if (this.disposed || this.video.readyState < 2 || !this.video.videoWidth) return;
    this.updateAutomaticLight(now);
    if (this.settings.cameraBackground !== 'none') this.requestMask(now);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawTo(this.context, this.video, this.video.videoWidth, this.video.videoHeight, 0, 0, this.canvas.width, this.canvas.height, 'settings');
    this.captureTrack.requestFrame?.();
  }

  private schedule() {
    const render = (now: number) => { this.drawPreview(now); if (!this.disposed) this.frameHandle = this.video.requestVideoFrameCallback?.(render) ?? null; };
    if (this.video.requestVideoFrameCallback) this.frameHandle = this.video.requestVideoFrameCallback(render);
    else this.fallbackTimer = window.setInterval(() => this.drawPreview(performance.now()), 1000 / Math.max(1, this.settings.cameraFps));
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this.frameHandle !== null) this.video.cancelVideoFrameCallback?.(this.frameHandle);
    if (this.fallbackTimer !== undefined) window.clearInterval(this.fallbackTimer);
    this.stopSegmentation(); this.video.pause(); this.video.srcObject = null;
    this.stream.getTracks().forEach(track => track.stop()); this.canvas.width = this.canvas.height = 0;
    for (const value of this.scratch.values()) { value.person.width = value.person.height = value.background.width = value.background.height = 0; }
    this.scratch.clear();
  }
}
