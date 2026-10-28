import { app, dialog, globalShortcut, Menu, session, protocol, powerSaveBlocker, Tray } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Preferences, validTwoKeyShortcut } from './settings';
import { RecordingStore } from './storage';
import { Windows, trusted } from '../windows/manager';
import { registerIPC } from '../ipc/handlers';
import { shortcutCommands, type Status, type Command, type ShortcutName } from '../../shared/types';
import { clickMonitor } from './cursor';
import { editorProxyPath } from './editor-proxy';

protocol.registerSchemesAsPrivileged([{ scheme: 'lr-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
// Automated packaged checks use an isolated profile. Production launches do
// not set this variable, so their normal Windows profile remains unchanged.
if (process.env.LOCAL_RECORDER_TEST_DIR) app.setPath('userData', path.resolve(process.env.LOCAL_RECORDER_TEST_DIR));
export const preferences = new Preferences();
export const windows = new Windows();
export let storage: RecordingStore;
export let state: Status = { phase: 'idle', elapsed: 0, mic: false, camera: false };
export let shortcutErrors: string[] = [];
export let recovered = 0;
let quitting = false;
let tray: Tray | null = null;
let blockId: number | undefined;
const recordingActive = () => ['preparing', 'countdown', 'recording', 'paused', 'finishing'].includes(state.phase);
export function setStore(value: RecordingStore) { storage = value; }
export function command(c: Command) { windows.main.webContents.send('command', c); }
export function setStatus(next: Status) {
  state = next;
  const active = ['preparing', 'countdown', 'recording', 'paused', 'finishing'].includes(state.phase);
  if (active) clickMonitor.activate(); else clickMonitor.stop();
  if (active && blockId === undefined) blockId = powerSaveBlocker.start('prevent-display-sleep');
  if (!active && blockId !== undefined) { powerSaveBlocker.stop(blockId); blockId = undefined; }
  if (!active) windows.showBubble(false, preferences.settings);
}
export function registerShortcuts() {
  globalShortcut.unregisterAll(); shortcutErrors = [];
  for (const [name, key] of Object.entries(preferences.settings.shortcuts)) {
    const mappedCommand = shortcutCommands[name as ShortcutName];
    if (!mappedCommand) { shortcutErrors.push(key); continue; }
    try { if (!globalShortcut.register(key, () => command(mappedCommand))) shortcutErrors.push(key); }
    catch { shortcutErrors.push(key); }
  }
}
export function checkShortcuts(shortcuts: typeof preferences.settings.shortcuts) {
  const values = Object.entries(shortcuts);
  if (values.length !== Object.keys(preferences.settings.shortcuts).length || values.some(([, key]) => !validTwoKeyShortcut(key))) return { valid: false, errors: ['Cada atajo debe usar una modificadora y una tecla.'] };
  if (new Set(values.map(([, key]) => key.toLowerCase())).size !== values.length) return { valid: false, errors: ['No repitas la misma combinación.'] };
  const errors: string[] = [];
  globalShortcut.unregisterAll();
  for (const [, key] of values) {
    try { if (!globalShortcut.register(key, () => {})) errors.push(`“${key}” está ocupado por Windows u otra aplicación.`); }
    catch { errors.push(`“${key}” no está disponible.`); }
  }
  globalShortcut.unregisterAll(); registerShortcuts();
  return { valid: errors.length === 0, errors };
}
export function exitReady() { quitting = true; app.quit(); }

async function mediaResponse(file: string, request: Request) {
  const stat = await fs.promises.stat(file);
  const size = stat.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  let start = 0, end = Math.max(0, size - 1), status = 200;
  if (match) {
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206;
  }
  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Content-Length': String(end - start + 1), 'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : 'video/webm', 'Cache-Control': 'no-store' });
  if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
  return new Response(stream, { status, headers });
}

function showMain() {
  if (!windows.main || windows.main.isDestroyed()) return;
  if (windows.main.isMinimized()) windows.main.restore();
  windows.revealMain();
  windows.camera?.showInactive();
  windows.main.focus();
}
function showPage(page: string) { showMain(); windows.main.webContents.send('navigate', page); }

async function requestExit() {
  if (recordingActive()) {
    showMain();
    const result = await dialog.showMessageBox(windows.main, { type: 'warning', message: 'Hay una grabación en curso.', detail: '¿Detener, guardar y salir por completo?', buttons: ['Cancelar', 'Detener y salir'], defaultId: 0, cancelId: 0 });
    if (result.response === 1) command('stop-exit');
    return;
  }
  if (storage.list().some(r => !r.saved)) {
    showMain();
    const result = await dialog.showMessageBox(windows.main, { type: 'question', message: 'Hay grabaciones sin guardar.', detail: 'Se conservarán como borradores en la biblioteca.', buttons: ['Volver', 'Conservar y salir'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) return;
  }
  exitReady();
}

function createTray() {
  tray = new Tray(path.join(__dirname, '../dist/icon.png'));
  tray.setToolTip('Tomixel');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Tomixel', click: showMain },
    { type: 'separator' },
    { label: 'Ayuda', submenu: [
      { label: 'Repetir tutorial completo', click: () => showPage('repeat-tutorial') },
      { label: 'Cómo grabar la pantalla', click: () => showPage('help') },
      { label: 'Cómo mejorar el audio', click: () => showPage('settings-audio') },
      { label: 'Cómo editar y exportar', click: () => showPage('help') },
      { label: 'Atajos de teclado', click: () => showPage('settings-shortcuts') }
    ] },
    { type: 'separator' },
    { label: 'Salir por completo', click: () => void requestExit() }
  ]));
  tray.on('click', showMain);
}

const isolatedTestProfile = !!process.env.LOCAL_RECORDER_TEST_DIR;
if (!isolatedTestProfile && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    await preferences.load();
    if (process.env.LOCAL_RECORDER_TEST_DIR && !process.env.LOCAL_RECORDER_TEST_ONBOARDING) {
      preferences.settings.onboardingVersion = 20;
      preferences.firstRun = false;
    }
    if (process.env.LOCAL_RECORDER_TEST_DIR) preferences.root = path.join(app.getPath('userData'), 'videos');
    storage = new RecordingStore(preferences.root);
    recovered = await storage.init();
    protocol.handle('lr-media', async request => {
      try {
        const u = new URL(request.url);
        if (!/^\/[a-f0-9-]{36}$/.test(u.pathname)) return new Response('Not found', { status: 404 });
        const id = u.pathname.slice(1);
        const media = u.hostname === 'recording' ? storage.getPath(id) : u.hostname === 'editor' ? editorProxyPath(id) : undefined;
        if (!media) return new Response('Not found', { status: 404 });
        return mediaResponse(media, request);
      } catch { return new Response('Not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(!!contents && trusted(contents.getURL()) && ['media', 'display-capture'].includes(permission)));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => !!contents && trusted(contents.getURL()) && ['media', 'display-capture'].includes(permission));
    // The packaged app never loads remote resources, even through an injected URL.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const protocol = new URL(details.url).protocol;
      callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(protocol) && !(!app.isPackaged && details.url.startsWith('http://127.0.0.1:5173/')) && !(!app.isPackaged && details.url.startsWith('ws://127.0.0.1:5173/')) });
    });
    registerIPC(); windows.open(); registerShortcuts(); createTray();
    windows.main.on('close', e => {
      if (quitting) return;
      e.preventDefault();
      windows.persistPosition();
      windows.hideMain();
      if (!recordingActive()) windows.camera?.hide();
      if (preferences.settings.onboardingVersion === 1 && tray) {
        tray.displayBalloon({ title: 'Tomixel sigue activo', content: 'Haz clic para abrirlo o clic derecho para consultar Ayuda y salir por completo.', iconType: 'info', noSound: true, respectQuietTime: true });
        preferences.settings.onboardingVersion = 2; void preferences.persist();
      }
    });
    windows.main.on('closed', () => { windows.camera?.destroy(); windows.teleprompter?.destroy(); });
  }).catch(e => { dialog.showErrorBox('Tomixel', String(e)); app.quit(); });
}
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { tray?.destroy(); tray = null; globalShortcut.unregisterAll(); clickMonitor.stop(); void storage?.closeHandles(); });
app.on('window-all-closed', () => {});
