import type { CaptureArea, CursorState, Settings } from '../../shared/types';
import { deliverySize, masterSize, sharpZoomLimit } from './media-quality';
import type { CameraEffectsProcessor } from './camera-effects';
export { deliverySize, masterSize, sharpZoomLimit } from './media-quality';

type DrawableVideo = HTMLVideoElement | HTMLImageElement;
type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: DOMHighResTimeStamp) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};
type ManualCanvasTrack = CanvasCaptureMediaStreamTrack & { requestFrame?: () => void };

export function cover(ctx: CanvasRenderingContext2D, video: DrawableVideo, x: number, y: number, width: number, height: number) {
  const vw = video instanceof HTMLVideoElement ? video.videoWidth : video.naturalWidth;
  const vh = video instanceof HTMLVideoElement ? video.videoHeight : video.naturalHeight;
  if (!vw || !vh || (video instanceof HTMLVideoElement && video.readyState < 2)) return;
  const scale = Math.max(width / vw, height / vh);
  const sw = width / scale, sh = height / scale;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, width, height);
}

export async function playable(stream: MediaStream) {
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play(); return video;
}

export class Compositor {
  canvas = document.createElement('canvas');
  stream: MediaStream;
  cameraVisible = true;
  position: { x: number; y: number } | null = null;
  private fallbackTimer: number | undefined;
  private sourceFrameCallback: number | null = null;
  private animationFrame: number | null = null;
  private captureTrack: ManualCanvasTrack;
  private frameDriver: FrameVideo | null;
  private lastCapturedAt = 0;
  private sourceFrameReady = true;
  private visualDirty = true;
  private missedFrameCount = 0;
  private avatar: HTMLImageElement | null = null;
  private avatarSource = '';
  private cursorTarget: CursorState | null = null;
  private cursorRendered: CursorState | null = null;
  private lastClick = -1;
  private lastZoom = 0;
  private zoomReady = false;
  private clickAt = 0;
  private zoomPercent = 100;
  private renderedZoom = 100;
  private zoomFrom = 100;
  private zoomStartedAt = 0;
  private zoomDuration = 0;
  private zoomCenter = { x: .5, y: .5 };
  private zoomTarget = { x: .5, y: .5 };
  private lastDrawAt = performance.now();
  private view: CaptureArea = { x: 0, y: 0, width: 1, height: 1 };
  private sourcePixels: { width: number; height: number };
  private context: CanvasRenderingContext2D;

  constructor(private screen: HTMLVideoElement | null, private camera: HTMLVideoElement | null, private settings: Settings, private crop?: CaptureArea, private cursorMapping = true, private cameraEffects: CameraEffectsProcessor | null = null) {
    const source = screen || camera;
    const sourceWidth = Math.max(2, (source?.videoWidth || 1920) * (screen && crop ? crop.width : 1));
    const sourceHeight = Math.max(2, (source?.videoHeight || 1080) * (screen && crop ? crop.height : 1));
    this.sourcePixels = { width: sourceWidth, height: sourceHeight };
    const master = masterSize(sourceWidth, sourceHeight);
    this.canvas.width = master.width;
    this.canvas.height = master.height;
    this.context = this.canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = 'high';
    this.configure(settings);
    this.draw(performance.now(), false);
    this.stream = this.canvas.captureStream(0);
    this.captureTrack = this.stream.getVideoTracks()[0] as ManualCanvasTrack;
    this.frameDriver = (screen || camera) as FrameVideo | null;
    this.captureTrack.requestFrame?.();
    this.scheduleFrames();
  }

  configure(settings: Settings) {
    this.settings = settings;
    this.visualDirty = true;
    if (settings.cameraImage !== this.avatarSource) {
      this.avatarSource = settings.cameraImage;
      this.avatar = settings.cameraImage ? new Image() : null;
      if (this.avatar) this.avatar.src = settings.cameraImage;
    }
  }

  get masterResolution() { return { width: this.canvas.width, height: this.canvas.height }; }
  get deliveryResolution() { return deliverySize(this.canvas.width, this.canvas.height, this.settings.captureResolution); }
  get droppedFrames() { return this.missedFrameCount; }
  resetFrameHealth() { this.missedFrameCount = 0; this.lastCapturedAt = performance.now(); }
  get sharpZoom() {
    const output = this.deliveryResolution;
    return sharpZoomLimit(this.sourcePixels.width, this.sourcePixels.height, output.width, output.height);
  }

  updateCursor(value: CursorState) {
    this.cursorTarget = value;
    this.visualDirty = true;
    if (!this.cursorRendered) this.cursorRendered = { ...value };
    if (this.lastClick < 0) this.lastClick = value.click;
    else if (value.click !== this.lastClick) { this.lastClick = value.click; this.clickAt = performance.now(); }
    if (!this.zoomReady) { this.lastZoom = value.zoom; this.zoomReady = true; }
    else if (value.zoom !== this.lastZoom) {
      this.beginZoom(Math.max(100, Math.min(300, this.zoomPercent + (value.zoom - this.lastZoom) * 50)));
      this.lastZoom = value.zoom;
    }
  }

  get zoom() { return this.zoomPercent; }
  cycleZoom() { this.beginZoom(this.zoomPercent >= 300 ? 100 : this.zoomPercent + 50); return this.zoomPercent; }
  toggleZoom(percent: 150 | 200) { this.beginZoom(this.zoomPercent === percent ? 100 : percent); return this.zoomPercent; }

  private beginZoom(percent: number) {
    const now = performance.now();
    this.animateZoom(now);
    this.zoomFrom = this.renderedZoom;
    this.zoomPercent = percent;
    this.zoomStartedAt = now;
    // Keep the transition visible, but short enough that the recorded view
    // reacts with the user's gesture instead of appearing one action behind.
    this.zoomDuration = percent > this.renderedZoom ? 300 : 240;
    this.visualDirty = true;
    if (percent <= 100) this.resetZoomCenter(false);
  }

  private focusOnCursor(value: CursorState) {
    const base = this.crop || { x: 0, y: 0, width: 1, height: 1 };
    if (!this.cursorMapping || !value.visible || value.x < base.x || value.x > base.x + base.width || value.y < base.y || value.y > base.y + base.height) return;
    this.zoomTarget = { x: value.x, y: value.y };
  }

  private resetZoomCenter(snap = true) {
    const base = this.crop || { x: 0, y: 0, width: 1, height: 1 };
    this.zoomTarget = { x: base.x + base.width / 2, y: base.y + base.height / 2 };
    if (snap) this.zoomCenter = { ...this.zoomTarget };
  }

  private animateZoom(now: number) {
    if (!this.zoomDuration) { this.renderedZoom = this.zoomPercent; return; }
    const progress = Math.min(1, Math.max(0, (now - this.zoomStartedAt) / this.zoomDuration));
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
    this.renderedZoom = this.zoomFrom + (this.zoomPercent - this.zoomFrom) * eased;
    if (progress >= 1) { this.renderedZoom = this.zoomPercent; this.zoomDuration = 0; if (this.zoomPercent === 100) this.resetZoomCenter(); }
  }

  private followTargets(now: number) {
    const elapsed = Math.min(100, Math.max(0, now - this.lastDrawAt));
    this.lastDrawAt = now;
    if (this.cursorTarget && this.cursorRendered) {
      const cursorEase = 1 - Math.exp(-elapsed / 55);
      this.cursorRendered.x += (this.cursorTarget.x - this.cursorRendered.x) * cursorEase;
      this.cursorRendered.y += (this.cursorTarget.y - this.cursorRendered.y) * cursorEase;
      this.cursorRendered.visible = this.cursorTarget.visible;
      this.cursorRendered.click = this.cursorTarget.click;
      this.cursorRendered.zoom = this.cursorTarget.zoom;
      if (this.renderedZoom > 100 || this.zoomPercent > 100) this.focusOnCursor(this.cursorRendered);
    }
    if (this.renderedZoom <= 100 && this.zoomPercent <= 100) return;
    const cameraEase = 1 - Math.exp(-elapsed / 85);
    this.zoomCenter.x += (this.zoomTarget.x - this.zoomCenter.x) * cameraEase;
    this.zoomCenter.y += (this.zoomTarget.y - this.zoomCenter.y) * cameraEase;
  }

  private drawCursor(ctx: CanvasRenderingContext2D, width: number, height: number, now: number) {
    if (!this.cursorMapping || !this.settings.cursorEffects || !this.cursorRendered?.visible) return;
    let x = this.cursorRendered.x, y = this.cursorRendered.y;
    if (x < this.view.x || y < this.view.y || x > this.view.x + this.view.width || y > this.view.y + this.view.height) return;
    x = (x - this.view.x) / this.view.width; y = (y - this.view.y) / this.view.height;
    const px = x * width, py = y * height, base = Math.max(8, height * .012);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 213, 47, .36)'; ctx.beginPath(); ctx.arc(px, py, base * 1.65, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd52f'; ctx.strokeStyle = 'rgba(28,30,35,.86)'; ctx.lineWidth = Math.max(1.5, height / 540);
    ctx.beginPath(); ctx.arc(px, py, base * .48, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const age = now - this.clickAt;
    if (age < 520) {
      const progress = age / 520;
      ctx.strokeStyle = `rgba(255, 87, 59, ${1 - progress})`; ctx.lineWidth = Math.max(3, height / 240);
      ctx.beginPath(); ctx.arc(px, py, base * (1.3 + progress * 2.2), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawCameraSubject(ctx: CanvasRenderingContext2D, subject: DrawableVideo, x: number, y: number, width: number, height: number) {
    if (subject === this.camera && this.cameraEffects && this.camera) {
      this.cameraEffects.drawTo(ctx, this.camera, this.camera.videoWidth, this.camera.videoHeight, x, y, width, height, 'recording');
    } else cover(ctx, subject, x, y, width, height);
  }

  private draw(now = performance.now(), emit = true) {
    const ctx = this.context;
    const width = this.canvas.width, height = this.canvas.height;
    ctx.fillStyle = '#17191e'; ctx.fillRect(0, 0, width, height);
    if (this.screen) {
      this.animateZoom(now);
      this.followTargets(now);
      const base = this.crop || { x: 0, y: 0, width: 1, height: 1 };
      const scale = this.renderedZoom / 100, viewWidth = base.width / scale, viewHeight = base.height / scale;
      const centerX = Math.max(base.x + viewWidth / 2, Math.min(base.x + base.width - viewWidth / 2, this.zoomCenter.x));
      const centerY = Math.max(base.y + viewHeight / 2, Math.min(base.y + base.height - viewHeight / 2, this.zoomCenter.y));
      this.view = { x: centerX - viewWidth / 2, y: centerY - viewHeight / 2, width: viewWidth, height: viewHeight };
      ctx.drawImage(this.screen, this.screen.videoWidth * this.view.x, this.screen.videoHeight * this.view.y, this.screen.videoWidth * this.view.width, this.screen.videoHeight * this.view.height, 0, 0, width, height);
    }
    this.drawCursor(ctx, width, height, now);
    const subject = this.settings.cameraView === 'image' ? this.avatar : this.camera;
    if (subject && this.cameraVisible) {
      if (!this.screen) {
        const scale = this.settings.cameraView === 'fullscreen' ? this.settings.fullscreenScale / 100 : 1;
        const w = width * scale, h = height * scale; this.drawCameraSubject(ctx, subject, (width - w) / 2, (height - h) / 2, w, h);
      } else if (this.settings.cameraView === 'fullscreen') {
        const scale = this.settings.fullscreenScale / 100, w = width * scale, h = height * scale;
        this.drawCameraSubject(ctx, subject, (width - w) / 2, (height - h) / 2, w, h);
      } else {
        const size = height * { small: .25, medium: .36, large: .44 }[this.settings.size];
        const margin = height * .025;
        const pos = this.position || { x: +!!this.settings.position.endsWith('right'), y: +!!this.settings.position.startsWith('bottom') };
        const x = margin + pos.x * (width - size - margin * 2), y = margin + pos.y * (height - size - margin * 2);
        ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip(); this.drawCameraSubject(ctx, subject, x, y, size, size); ctx.restore();
        ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.lineWidth = Math.max(2, height / 360); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
      }
    }
    if (emit) this.captureTrack.requestFrame?.();
  }

  private scheduleFrames() {
    const minimumFrameTime = 1000 / this.settings.screenFps;
    const sourceCallback = () => {
      this.sourceFrameReady = true;
      this.sourceFrameCallback = this.frameDriver?.requestVideoFrameCallback?.(sourceCallback) ?? null;
    };
    if (this.frameDriver?.requestVideoFrameCallback) this.sourceFrameCallback = this.frameDriver.requestVideoFrameCallback(sourceCallback);
    const animate = (now: DOMHighResTimeStamp) => {
      const due = now - this.lastCapturedAt >= minimumFrameTime - 1;
      const moving = this.zoomDuration > 0 || this.zoomPercent > 100 || !!(this.camera && this.cameraVisible) || now - this.clickAt < 520;
      if (due && (this.sourceFrameReady || this.visualDirty || moving)) {
        if (this.lastCapturedAt && now - this.lastCapturedAt > minimumFrameTime * 1.8) this.missedFrameCount += Math.max(0, Math.floor((now - this.lastCapturedAt) / minimumFrameTime) - 1);
        this.lastCapturedAt = now; this.sourceFrameReady = false; this.visualDirty = false; this.draw(now);
      }
      this.animationFrame = requestAnimationFrame(animate);
    };
    if (typeof requestAnimationFrame === 'function') this.animationFrame = requestAnimationFrame(animate);
    else this.fallbackTimer = window.setInterval(() => this.draw(performance.now()), minimumFrameTime);
  }

  dispose() {
    if (this.sourceFrameCallback !== null) this.frameDriver?.cancelVideoFrameCallback?.(this.sourceFrameCallback);
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    if (this.fallbackTimer !== undefined) clearInterval(this.fallbackTimer);
    this.stream.getTracks().forEach(track => track.stop());
    for (const video of [this.screen, this.camera]) if (video) { video.pause(); video.srcObject = null; }
    this.canvas.width = this.canvas.height = 0;
  }
}
