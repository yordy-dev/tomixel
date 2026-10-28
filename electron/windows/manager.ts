import { app, BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Settings } from '../../shared/types';

export const devURL = !process.env.LOCAL_RECORDER_PACKAGED_TEST && process.env.VITE_DEV_SERVER_URL === 'http://127.0.0.1:5173' ? process.env.VITE_DEV_SERVER_URL : undefined;
export const entry = path.join(__dirname, '../dist/index.html');
export function trusted(url: string) {
  try { const u = new URL(url); return devURL ? u.origin === devURL : u.protocol === 'file:' && u.pathname === new URL(pathToFileURL(entry).href).pathname; } catch { return false; }
}
export class Windows {
  main!: BrowserWindow;
  camera: BrowserWindow | null = null;
  teleprompter: BrowserWindow | null = null;
  private lastPage = '';
  private beforeCountdown: Electron.Rectangle | null = null;
  private bubbleBounds: Electron.Rectangle | null = null;
  private bubbleFullscreen = false;
  private forceBubbleFullscreen = false;
  private resizingBubble = false;
  private bubblePosition = { x: 0, y: 1 };
  private positionMode: 'main' | 'controller' = 'main';
  private suspendPositionPersistence = false;
  private positionUnlockTimer: NodeJS.Timeout | null = null;
  private mainHiddenByUser = false;
  private controllerPinned = false;
  private revealTimer: NodeJS.Timeout | null = null;
  private readonly positionsFile = path.join(app.getPath('userData'), 'window-positions.json');
  private positions: { main?: { x: number; y: number }; controller?: { x: number; y: number }; camera?: { x: number; y: number } } = this.loadPositions();
  private loadPositions() {
    try {
      const value = JSON.parse(fs.readFileSync(this.positionsFile, 'utf8')) as Record<string, unknown>;
      const point = (candidate: unknown) => candidate && typeof candidate === 'object' && Number.isFinite((candidate as { x?: unknown }).x) && Number.isFinite((candidate as { y?: unknown }).y) ? { x: Number((candidate as { x: number }).x), y: Number((candidate as { y: number }).y) } : undefined;
      return { main: point(value.main), controller: point(value.controller), camera: point(value.camera) };
    } catch { return {}; }
  }
  private savePositions() {
    try {
      fs.mkdirSync(path.dirname(this.positionsFile), { recursive: true });
      const temporary = `${this.positionsFile}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.positions), 'utf8');
      fs.renameSync(temporary, this.positionsFile);
    } catch { /* A failed preference write must not interrupt recording. */ }
  }
  private saveMainPosition() {
    if (this.suspendPositionPersistence || !this.main || this.main.isDestroyed()) return;
    const [x, y] = this.main.getPosition();
    this.positions[this.positionMode] = { x, y };
    this.savePositions();
  }
  /** Persist the user's last controller/camera location before the window is hidden. */
  persistPosition() {
    this.saveMainPosition();
    if (!this.camera || this.camera.isDestroyed() || this.bubbleFullscreen || this.resizingBubble) return;
    const bounds = this.camera.getBounds();
    const display = screen.getDisplayMatching(bounds).workArea;
    this.bubblePosition = {
      x: Math.max(0, Math.min(1, (bounds.x - display.x - 24) / Math.max(1, display.width - bounds.width - 48))),
      y: Math.max(0, Math.min(1, (bounds.y - display.y - 24) / Math.max(1, display.height - bounds.height - 48)))
    };
    this.positions.camera = this.bubblePosition;
    this.savePositions();
  }
  hideMain() { this.mainHiddenByUser = true; this.main.hide(); }
  revealMain() { this.mainHiddenByUser = false; this.main.show(); }
  private clampPosition(position: { x: number; y: number }, width: number, height: number) {
    const area = screen.getDisplayMatching({ x: position.x, y: position.y, width, height }).workArea;
    return { x: Math.max(area.x, Math.min(position.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(position.y, area.y + area.height - height)) };
  }
  private refreshProtection(win: BrowserWindow) { win.setContentProtection(false); setTimeout(() => { if (!win.isDestroyed()) win.setContentProtection(true); }, 80); }
  private blockCloseShortcut(win: BrowserWindow) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && !input.alt && !input.meta && input.key.toLowerCase() === 'w') event.preventDefault();
    });
  }
  private pinOverlay(win: BrowserWindow) {
    if (win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (win.isVisible()) win.moveTop();
  }
  private reinforceOverlay(win: BrowserWindow) {
    setTimeout(() => this.pinOverlay(win), 40);
  }
  private create(width: number, height: number, bubble = false) {
    const win = new BrowserWindow({ width, height, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: !bubble, resizable: false, maximizable: false,
      title: bubble ? 'Tomixel Camera' : 'Tomixel', autoHideMenuBar: true, icon: path.join(__dirname, '../dist/icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false }
    });
    this.blockCloseShortcut(win);
    win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => { if (!trusted(url)) e.preventDefault(); });
    if (devURL) void win.loadURL(`${devURL}${bubble ? '/#bubble' : ''}`);
    else void win.loadFile(entry, bubble ? { hash: 'bubble' } : {});
    return win;
  }
  open() {
    this.main = this.create(360, 660);
    const area = screen.getPrimaryDisplay().workArea;
    const initial = this.positions.main || { x: area.x + area.width - 390, y: area.y + 38 };
    const position = this.clampPosition(initial, 360, 660);
    this.main.setPosition(position.x, position.y);
    this.positions.main = position;
    this.savePositions();
    this.main.on('move', () => this.saveMainPosition());
    this.main.on('blur', () => { if (this.controllerPinned) this.reinforceOverlay(this.main); });
    this.main.on('show', () => { if (this.controllerPinned) this.reinforceOverlay(this.main); });
    this.main.once('ready-to-show', () => this.main.show());
    return this.main;
  }
  showTeleprompter(s: Settings) {
    if (this.teleprompter && !this.teleprompter.isDestroyed()) {
      if (this.teleprompter.isVisible()) { this.hideTeleprompter(); return; }
      this.teleprompter.show(); this.teleprompter.setContentProtection(true); this.teleprompter.focus(); this.teleprompter.webContents.send('bubble-config', s); this.teleprompter.webContents.send('teleprompter-visibility', true); return;
    }
    const area = screen.getDisplayMatching(this.main.getBounds()).workArea;
    this.teleprompter = new BrowserWindow({ width: s.teleprompterWidth, height: 330, x: area.x + Math.round((area.width - s.teleprompterWidth) / 2), y: area.y + 24, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: true, minWidth: 360, minHeight: 180, alwaysOnTop: true, skipTaskbar: true, title: 'Tomixel Teleprompter', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
    this.blockCloseShortcut(this.teleprompter);
    this.teleprompter.setContentProtection(true);
    this.teleprompter.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.teleprompter.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
    if (devURL) void this.teleprompter.loadURL(`${devURL}/#teleprompter`); else void this.teleprompter.loadFile(entry, { hash: 'teleprompter' });
    this.teleprompter.once('ready-to-show', () => { if (this.teleprompter) { this.teleprompter.show(); this.teleprompter.setContentProtection(true); this.teleprompter.webContents.send('bubble-config', s); this.teleprompter.webContents.send('teleprompter-visibility', true); } });
    this.teleprompter.on('closed', () => { this.teleprompter = null; });
  }
  hideTeleprompter() { if (this.teleprompter && !this.teleprompter.isDestroyed()) { this.teleprompter.webContents.send('teleprompter-visibility', false); this.teleprompter.hide(); } }
  prepareForCapture() { if (this.teleprompter && !this.teleprompter.isDestroyed() && this.teleprompter.isVisible()) this.teleprompter.setContentProtection(true); }
  stageLayout(page: string, s: Settings) {
    if (this.main.isDestroyed()) return;
    if (this.revealTimer) { clearInterval(this.revealTimer); this.revealTimer = null; }
    this.main.setOpacity(0);
    this.layout(page, s);
  }
  revealLayout() {
    if (this.main.isDestroyed()) return;
    if (!this.mainHiddenByUser) { this.main.showInactive(); if (this.controllerPinned) this.reinforceOverlay(this.main); }
    const started = Date.now();
    if (this.revealTimer) clearInterval(this.revealTimer);
    this.revealTimer = setInterval(() => {
      if (this.main.isDestroyed()) { if (this.revealTimer) clearInterval(this.revealTimer); this.revealTimer = null; return; }
      const progress = Math.min(1, (Date.now() - started) / 90);
      this.main.setOpacity(1 - Math.pow(1 - progress, 3));
      if (progress >= 1) { if (this.revealTimer) clearInterval(this.revealTimer); this.revealTimer = null; }
    }, 16);
  }
  layout(page: string, s: Settings) {
    if (this.lastPage === page) return;
    this.lastPage = page;
    if (page === 'countdown') {
      this.controllerPinned = true;
      if (this.positionUnlockTimer) { clearTimeout(this.positionUnlockTimer); this.positionUnlockTimer = null; }
      this.suspendPositionPersistence = true;
      this.beforeCountdown = this.main.getBounds();
      this.main.setBounds(screen.getDisplayMatching(this.beforeCountdown).bounds);
      this.pinOverlay(this.main);
      if (!this.mainHiddenByUser) { this.main.showInactive(); this.reinforceOverlay(this.main); } return;
    }
    const sizes: Record<string, [number, number]> = { home: [360, 660], settings: [800, 700], library: [800, 700], sources: [800, 660], preview: [980, 820], help: [720, 700], controller: [450, 175], 'controller-zoom': [560, 475], countdown: [360, 300] };
    const size = sizes[page]; if (!size) return;
    const controller = page.startsWith('controller');
    const nextMode: 'main' | 'controller' = controller ? 'controller' : 'main';
    if (this.positionUnlockTimer) { clearTimeout(this.positionUnlockTimer); this.positionUnlockTimer = null; }
    this.suspendPositionPersistence = true;
    const origin = this.beforeCountdown || this.main.getBounds();
    this.beforeCountdown = null;
    const currentX = origin.x, currentY = origin.y;
    const saved = this.positions[nextMode] || { x: currentX, y: currentY };
    const position = this.clampPosition(saved, size[0], size[1]);
    if (!this.positions[nextMode]) { this.positions[nextMode] = position; this.savePositions(); }
    this.main.setBounds({ x: position.x, y: position.y, width: size[0], height: size[1] });
    // Windows dispatches move/resize after setBounds returns. Keep automatic
    // layout events out of the persisted user position until they settle.
    this.positionUnlockTimer = setTimeout(() => { this.suspendPositionPersistence = false; this.positionUnlockTimer = null; }, 140);
    this.positionMode = nextMode;
    this.controllerPinned = controller && s.alwaysOnTop;
    if (this.controllerPinned) this.pinOverlay(this.main); else this.main.setAlwaysOnTop(false);
    if (controller && !s.showControls) this.main.hide();
    else if (!this.mainHiddenByUser) { if (controller) this.refreshProtection(this.main); this.main.showInactive(); if (this.controllerPinned) this.reinforceOverlay(this.main); }
  }
  bubbleSettings(s: Settings): Settings { return this.forceBubbleFullscreen ? { ...s, cameraView: 'fullscreen' } : s; }
  showBubble(show: boolean, s: Settings, forceFullscreen = false) {
    if (!show) { this.camera?.destroy(); this.camera = null; this.bubbleFullscreen = false; this.forceBubbleFullscreen = false; this.bubbleBounds = null; return; }
    this.forceBubbleFullscreen = forceFullscreen;
    if (this.camera) { this.updateBubble(s); return; }
    const size = { small: 202, medium: 290, large: 360 }[s.size];
    const area = screen.getDisplayMatching(this.main.getBounds()).workArea;
    const height = size + 24;
    this.bubblePosition = this.positions.camera || { x: s.position.endsWith('right') ? 1 : 0, y: s.position.startsWith('top') ? 0 : 1 };
    this.camera = this.create(size, size + 24, true);
    // The camera is a recording overlay. It must remain visible over the
    // selected application even when the separate controller is allowed to
    // move behind other windows.
    this.pinOverlay(this.camera);
    this.camera.setSkipTaskbar(true);
    this.camera.setPosition(Math.round(area.x + 24 + this.bubblePosition.x * Math.max(0, area.width - size - 48)), Math.round(area.y + 24 + this.bubblePosition.y * Math.max(0, area.height - height - 48)));
    this.updateBubble(s);
    this.camera.once('ready-to-show', () => { if (this.camera) { this.refreshProtection(this.camera); this.camera.showInactive(); this.reinforceOverlay(this.camera); } });
    this.camera.on('blur', () => { if (this.camera) this.reinforceOverlay(this.camera); });
    this.camera.on('show', () => { if (this.camera) this.reinforceOverlay(this.camera); });
    this.camera.on('move', () => {
      if (!this.camera || this.bubbleFullscreen || this.resizingBubble) return;
      const b = this.camera.getBounds(); const display = screen.getDisplayMatching(b).workArea;
      this.bubblePosition = { x: Math.max(0, Math.min(1, (b.x - display.x - 24) / Math.max(1, display.width - b.width - 48))), y: Math.max(0, Math.min(1, (b.y - display.y - 24) / Math.max(1, display.height - b.height - 48))) };
      this.positions.camera = this.bubblePosition;
      this.savePositions();
      this.main.webContents.send('bubble-position', this.bubblePosition);
    });
  }
  updateBubble(s: Settings) {
    if (!this.camera) return;
    this.pinOverlay(this.camera);
    s = this.bubbleSettings(s);
    this.resizingBubble = true;
    try {
      const current = this.camera.getBounds();
      if (s.cameraView === 'fullscreen') {
        if (!this.bubbleFullscreen) this.bubbleBounds = current;
        this.bubbleFullscreen = true;
        const display = screen.getDisplayMatching(this.bubbleBounds || current).bounds;
        const scale = s.fullscreenScale / 100;
        const width = Math.max(1, Math.round(display.width * scale)), height = Math.max(1, Math.round(display.height * scale));
        this.camera.setBounds({ x: display.x + Math.round((display.width - width) / 2), y: display.y + Math.round((display.height - height) / 2), width, height });
      } else {
        const wasFullscreen = this.bubbleFullscreen;
        const anchor = wasFullscreen && this.bubbleBounds ? this.bubbleBounds : current;
        this.bubbleFullscreen = false;
        const area = screen.getDisplayMatching(anchor).workArea;
        const size = { small: 202, medium: 290, large: 360 }[s.size];
        const height = size + 24;
        this.camera.setBounds({ x: Math.round(area.x + 24 + this.bubblePosition.x * Math.max(0, area.width - size - 48)), y: Math.round(area.y + 24 + this.bubblePosition.y * Math.max(0, area.height - height - 48)), width: size, height });
        if (wasFullscreen) this.bubbleBounds = null;
      }
      this.reinforceOverlay(this.camera);
      if (this.lastPage.startsWith('controller') && this.controllerPinned) this.reinforceOverlay(this.main);
    } finally { this.resizingBubble = false; }
  }
}
