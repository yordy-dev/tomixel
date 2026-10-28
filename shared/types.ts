export type Phase = 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'finishing' | 'finished';
export type Command = 'record' | 'pause' | 'mic' | 'zoom150' | 'zoom200' | 'camera' | 'camera-remove' | 'camera-small' | 'camera-medium' | 'camera-fullscreen' | 'camera-image' | 'stop' | 'stop-exit' | 'open-help' | 'repeat-tutorial';
export type CameraAction = 'remove' | 'small' | 'medium' | 'fullscreen' | 'image';
export const TELEPROMPTER_SPEEDS = [50, 80, 110, 160, 220] as const;
export const TELEPROMPTER_SPEED_LABELS = ['Muy lento', 'Lento', 'Normal', 'Rápido', 'Muy rápido'] as const;
export const TELEPROMPTER_WELCOME = '¡Bienvenido! Este es tu espacio para preparar lo que vas a decir. Reemplaza este mensaje por tu propio guion cuando quieras.';
export function isLegacyTeleprompterText(value: string) {
  const text = value.trim();
  return /^Escribe tu guion en Ajustes\s*(?:→|->)\s*Guion\.?$/i.test(text)
    || (text.startsWith('Hola, ¿qué tal? Bienvenidos a este pequeño tutorial.') && text.includes('**[MOVER EL CURSOR POR LA PANTALLA]**'));
}
export function hasTeleprompterScript(value: string) { return Boolean(value.trim() && !isLegacyTeleprompterText(value)); }
// Increment this when the first-run tour gains meaningful new coverage.
// Existing profiles then see the improved tour once, while a completed tour
// remains skipped on subsequent launches.
export const CURRENT_TUTORIAL_VERSION = 5;
export interface Settings {
  micId: string; cameraId: string; micEnabled: boolean; cameraEnabled: boolean; systemAudio: boolean;
  noiseSuppression: boolean; neuralNoiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean; micGain: number; systemGain: number;
  screenFps: number; cameraFps: number; cameraResolution: number; quality: 'low' | 'medium' | 'high' | 'very-high';
  mirrorPreview: boolean; size: 'small' | 'medium' | 'large'; cursorEffects: boolean;
  cameraAutoLight: boolean; cameraBrightness: number; cameraContrast: number; cameraTemperature: number; cameraSaturation: number;
  cameraBackground: 'none' | 'blur-soft' | 'blur-strong' | 'image'; cameraBackgroundImage: string;
  cameraView: 'bubble' | 'fullscreen' | 'image'; cameraImage: string; fullscreenScale: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  countdown: number; alwaysOnTop: boolean; showControls: boolean; autoSave: boolean; openAfterSave: boolean;
  captureResolution: '1080p' | '1440p' | '2160p' | 'native'; onboardingVersion: number;
  voiceProfile: 'natural' | 'noisy' | 'room' | 'speakers';
  teleprompterText: string; teleprompterSpeed: number; teleprompterFontSize: number; teleprompterOpacity: number; teleprompterWidth: number;
  theme: 'system' | 'light' | 'dark'; shortcuts: { record: string; pause: string; mic: string; zoom150: string; zoom200: string; cameraSmall: string; cameraMedium: string; cameraFullscreen: string; cameraImage: string };
}
export type ShortcutName = keyof Settings['shortcuts'];
export const shortcutCommands: Record<ShortcutName, Command> = {
  record: 'record',
  pause: 'pause',
  mic: 'mic',
  zoom150: 'zoom150',
  zoom200: 'zoom200',
  cameraSmall: 'camera-small',
  cameraMedium: 'camera-medium',
  cameraFullscreen: 'camera-fullscreen',
  cameraImage: 'camera-image'
};
export const defaults: Settings = {
  micId: '', cameraId: '', micEnabled: true, cameraEnabled: true, systemAudio: false,
  noiseSuppression: false, neuralNoiseSuppression: true, echoCancellation: true, autoGainControl: false, micGain: .8, systemGain: .55,
  screenFps: 30, cameraFps: 30, cameraResolution: 1080, quality: 'high', mirrorPreview: true,
  cameraAutoLight: false, cameraBrightness: 0, cameraContrast: 0, cameraTemperature: 0, cameraSaturation: 0,
  cameraBackground: 'none', cameraBackgroundImage: '',
  size: 'small', cursorEffects: true, position: 'bottom-left', countdown: 3, alwaysOnTop: true,
  cameraView: 'bubble', cameraImage: '', fullscreenScale: 100,
  captureResolution: '1080p', onboardingVersion: 0, voiceProfile: 'natural',
  teleprompterText: TELEPROMPTER_WELCOME, teleprompterSpeed: 110, teleprompterFontSize: 34, teleprompterOpacity: .88, teleprompterWidth: 620,
  showControls: true, autoSave: false, openAfterSave: false, theme: 'system',
  shortcuts: { record: 'Control+R', pause: 'Control+P', mic: 'Control+M', zoom150: 'Control+1', zoom200: 'Control+2', cameraSmall: 'Control+Q', cameraMedium: 'Control+W', cameraFullscreen: 'Control+E', cameraImage: 'Control+I' }
};
export interface CutRange { start: number; end: number }
export interface CaptureArea { x: number; y: number; width: number; height: number }
export interface Source { id: string; name: string; thumbnail: string; icon?: string; displayId: string; width?: number; height?: number; crop?: CaptureArea }
export interface Recording { id: string; title: string; filename: string; createdAt: string; duration: number; size: number; saved: boolean; recovered?: boolean; cuts?: CutRange[] }
export interface Status { phase: Phase; elapsed: number; mic: boolean; camera: boolean }
export interface CursorState { x: number; y: number; click: number; zoom: number; visible: boolean }
export interface StorageStats { freeBytes: number; totalBytes: number }
export interface CameraVideoPacket { data: ArrayBuffer; type: 'key' | 'delta'; timestamp: number; duration?: number; width: number; height: number; capturedAt: number }
export type CameraEffectPerformance = 'off' | 'loading' | 'optimal' | 'limited' | 'unavailable';
export interface Config { settings: Settings; root: string; systemAudioSupported: boolean; shortcutErrors: string[]; recovered: number; firstRun: boolean }
export interface DesktopAPI {
  config(): Promise<Config>; setSettings(s: Settings): Promise<Config>; chooseFolder(): Promise<string | null>;
  validateShortcuts(s: Settings['shortcuts']): Promise<{ valid: boolean; errors: string[] }>;
  sources(): Promise<Source[]>; selectSource(id: string, audio: boolean): Promise<void>;
  begin(): Promise<string>; abort(id: string): Promise<void>; append(id: string, chunk: ArrayBuffer): Promise<void>; finish(id: string, duration: number): Promise<Recording>;
  save(id: string, title: string): Promise<Recording>; discard(id: string): Promise<boolean>;
  discardRestart(id: string): Promise<boolean>;
  saveEdits(id: string, cuts: CutRange[]): Promise<Recording>; saveScreenshot(id: string, png: ArrayBuffer): Promise<string | null>; copyScreenshot(png: ArrayBuffer): Promise<boolean>;
  library(): Promise<Recording[]>; rename(id: string, title: string): Promise<Recording>; remove(id: string): Promise<boolean>; removeMany(ids: string[]): Promise<number>;
  thumbnail(id: string): Promise<string | null>; editorProxy(id: string): Promise<string>; exportMp4(id: string, title: string, cuts: CutRange[], duration: number): Promise<string | null>;
  cursor(displayId: string): Promise<CursorState>; storageStats(): Promise<StorageStats>;
  openFolder(id?: string): Promise<void>; status(s: Status): Promise<void>; layout(page: string): Promise<void>;
  stageLayout(page: string): Promise<void>; revealLayout(): Promise<void>;
  close(): Promise<void>; minimize(): Promise<void>; bubble(show: boolean, fullscreen?: boolean): Promise<void>; bubbleConfig(): Promise<Settings>;
  cameraAction(action: CameraAction): Promise<Settings>; chooseCameraImage(): Promise<Settings | null>;
  chooseCameraBackground(): Promise<Settings | null>;
  setFullscreenScale(value: number): Promise<Settings>;
  moveBubble(delta: { x: number; y: number }): Promise<void>;
  cameraVideoReady(): void; cameraVideoPacket(packet: CameraVideoPacket): void;
  onCommand(fn: (c: Command) => void): () => void;
  onPosition(fn: (p: { x: number; y: number }) => void): () => void;
  onBubbleConfig(fn: (s: Settings) => void): () => void;
  onCameraVideoReady(fn: () => void): () => void; onCameraVideoPacket(fn: (packet: CameraVideoPacket) => void): () => void;
  onTeleprompterVisibility(fn: (visible: boolean) => void): () => void;
  onEditorProgress(fn: (value: { id: string; percent: number; stage: string }) => void): () => void;
  onNavigate(fn: (page: string) => void): () => void;
  showTeleprompter(): Promise<void>; hideTeleprompter(): Promise<void>;
  exitReady(): Promise<void>;
}
