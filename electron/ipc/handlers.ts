import { ipcMain, clipboard, desktopCapturer, dialog, session, shell, nativeImage, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { preferences, storage, windows, state, setStatus, setStore, shortcutErrors, recovered, registerShortcuts, checkShortcuts, exitReady } from '../main/index';
import { validateSettings } from '../main/settings';
import { RecordingStore } from '../main/storage';
import { trusted } from '../windows/manager';
import { exportMp4 } from '../main/exporter';
import { clickMonitor } from '../main/cursor';
import { prepareEditorProxy } from '../main/editor-proxy';
import type { CameraVideoPacket } from '../../shared/types';

export function registerIPC() {
  let selection: { id: string; audio: boolean; expires: number } | null = null;
  let tail = Promise.resolve();
  const config = () => ({ settings: preferences.settings, root: preferences.root, systemAudioSupported: process.platform === 'win32', shortcutErrors, recovered: storage ? storage.list().filter(item => item.recovered).length : recovered, firstRun: preferences.firstRun });
  function handle(channel: string, fn: (...args: any[]) => unknown, serial = false, allowBubble = false) {
    ipcMain.handle(channel, (event, ...args) => {
      const sender = event.sender;
      if (!event.senderFrame || event.senderFrame !== sender.mainFrame || !trusted(event.senderFrame.url) || (sender !== windows.main?.webContents && !(allowBubble && (sender === windows.camera?.webContents || sender === windows.teleprompter?.webContents)))) throw new Error('Solicitud no autorizada.');
      if (!serial) return fn(...args);
      const result = tail.then(() => fn(...args)); tail = result.then(() => undefined, () => undefined); return result;
    });
  }
  const trustedVideoSender = (event: Electron.IpcMainEvent) => event.senderFrame && event.senderFrame === event.sender.mainFrame && trusted(event.senderFrame.url);
  ipcMain.on('camera-video-ready', event => {
    const sender = event.sender;
    if (!trustedVideoSender(event) || sender !== windows.camera?.webContents) return;
    windows.main?.webContents.send('camera-video-ready');
  });
  ipcMain.on('camera-video-packet', (event, packet: CameraVideoPacket) => {
    if (!trustedVideoSender(event) || event.sender !== windows.main?.webContents || !packet || typeof packet !== 'object') return;
    if (!(packet.data instanceof ArrayBuffer) || packet.data.byteLength < 1 || packet.data.byteLength > 2 * 1024 * 1024 || !['key', 'delta'].includes(packet.type) || !Number.isSafeInteger(packet.timestamp) || !Number.isInteger(packet.width) || !Number.isInteger(packet.height) || packet.width < 1 || packet.height < 1 || packet.width > 4096 || packet.height > 2160 || !Number.isFinite(packet.capturedAt) || Math.abs(Date.now() - packet.capturedAt) > 60_000) return;
    if (windows.camera && !windows.camera.isDestroyed()) windows.camera.webContents.send('camera-video-packet', packet);
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const choice = selection; selection = null;
    if (!choice || Date.now() > choice.expires || request.frame !== windows.main.webContents.mainFrame) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(s => s.id === choice.id);
      if (!source) { callback({}); return; }
      callback({ video: source, ...(choice.audio && process.platform === 'win32' ? { audio: 'loopback' as const } : {}) });
    } catch { callback({}); }
  });
  handle('config', config, false, true);
  const broadcastCamera = () => {
    windows.main.webContents.send('bubble-config', preferences.settings);
    windows.camera?.webContents.send('bubble-config', windows.bubbleSettings(preferences.settings));
    windows.teleprompter?.webContents.send('bubble-config', preferences.settings);
    windows.updateBubble(preferences.settings);
    if (windows.teleprompter && !windows.teleprompter.isDestroyed()) {
      const [, height] = windows.teleprompter.getSize();
      windows.teleprompter.setSize(preferences.settings.teleprompterWidth, height, true);
    }
  };
  handle('bubble-config-current', () => windows.bubbleSettings(preferences.settings), false, true);
  handle('teleprompter-show', () => windows.showTeleprompter(preferences.settings));
  handle('teleprompter-hide', () => windows.hideTeleprompter(), false, true);
  handle('bubble-move', delta => {
    if (!delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y) || Math.abs(delta.x) > 5000 || Math.abs(delta.y) > 5000) throw new Error('Movimiento inválido.');
    if (!windows.camera || preferences.settings.cameraView === 'fullscreen') return;
    const [x, y] = windows.camera.getPosition(); windows.camera.setPosition(Math.round(x + delta.x), Math.round(y + delta.y));
  }, false, true);
  handle('camera-action', async action => {
    if (!['remove', 'small', 'medium', 'fullscreen', 'image'].includes(action)) throw new Error('Acción de cámara inválida.');
    // Camera shortcuts and the floating menu are useful before recording,
    // while recording, and after a finished preview. Keep them available
    // through the full lifecycle; only the finalizing/countdown transition
    // must remain protected from window changes.
    if (!['idle', 'preparing', 'recording', 'paused', 'finished'].includes(state.phase)) throw new Error('Espera a que termine la preparación.');
    const previous = preferences.settings;
    const next = { ...previous };
    if (action === 'small' || action === 'medium') { next.size = action; if (next.cameraView === 'fullscreen') next.cameraView = 'bubble'; }
    if (action === 'fullscreen') next.cameraView = next.cameraView === 'fullscreen' ? 'bubble' : 'fullscreen';
    if (action === 'image') {
      if (!next.cameraImage) throw new Error('Primero carga tu imagen en Ajustes → Cámara → Imagen de cámara.');
      next.cameraView = next.cameraView === 'image' ? 'bubble' : 'image';
    }
    if (action === 'remove' && state.phase === 'idle') next.cameraEnabled = false;
    preferences.settings = validateSettings(next);
    try { await preferences.persist(); } catch (e) { preferences.settings = previous; throw e; }
    broadcastCamera();
    if (action === 'remove') {
      if (state.phase !== 'idle') windows.main.webContents.send('command', 'camera-remove');
      windows.showBubble(false, next);
    }
    return preferences.settings;
  }, true, true);
  handle('camera-scale', async value => {
    if (windows.bubbleSettings(preferences.settings).cameraView !== 'fullscreen') throw new Error('La escala solo se cambia en pantalla completa.');
    if (!Number.isInteger(value) || value < 10 || value > 100 || value % 10) throw new Error('Escala inválida.');
    const previous = preferences.settings;
    preferences.settings = validateSettings({ ...previous, fullscreenScale: value });
    try { await preferences.persist(); } catch (e) { preferences.settings = previous; throw e; }
    broadcastCamera(); return preferences.settings;
  }, true, true);
  handle('camera-image', async () => {
    if (!['idle', 'paused', 'finished'].includes(state.phase)) throw new Error('Pausa la grabación antes de cargar una imagen.');
    const selected = await dialog.showOpenDialog(windows.main, { title: 'Elegir imagen para la cámara', properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (selected.canceled) return null;
    const file = selected.filePaths[0];
    if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('La imagen debe pesar menos de 8 MB.');
    const original = nativeImage.createFromPath(file);
    if (original.isEmpty()) throw new Error('No se pudo abrir esa imagen. Usa PNG, JPG o WebP.');
    const { width, height } = original.getSize();
    const image = original.resize(width >= height ? { width: Math.min(512, width) } : { height: Math.min(512, height) });
    const previous = preferences.settings;
    preferences.settings = validateSettings({ ...previous, cameraImage: image.toDataURL() });
    try { await preferences.persist(); } catch (e) { preferences.settings = previous; throw e; }
    broadcastCamera(); return preferences.settings;
  }, true);
  handle('camera-background-image', async () => {
    if (!['idle', 'paused', 'finished'].includes(state.phase)) throw new Error('Pausa la grabación antes de cambiar el fondo.');
    const selected = await dialog.showOpenDialog(windows.main, { title: 'Elegir fondo para la cámara', properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (selected.canceled) return null;
    const file = selected.filePaths[0];
    if ((await fs.stat(file)).size > 12 * 1024 * 1024) throw new Error('La imagen debe pesar menos de 12 MB.');
    const original = nativeImage.createFromPath(file);
    if (original.isEmpty()) throw new Error('No se pudo abrir esa imagen. Usa PNG, JPG o WebP.');
    const { width, height } = original.getSize();
    const image = original.resize(width >= height ? { width: Math.min(1920, width) } : { height: Math.min(1080, height) });
    const data = `data:image/jpeg;base64,${image.toJPEG(88).toString('base64')}`;
    const previous = preferences.settings;
    preferences.settings = validateSettings({ ...previous, cameraBackgroundImage: data, cameraBackground: 'image' });
    try { await preferences.persist(); } catch (e) { preferences.settings = previous; throw e; }
    broadcastCamera(); return preferences.settings;
  }, true);
  handle('settings', async input => {
    if (['countdown', 'finishing'].includes(state.phase)) throw new Error('Espera a que termine esta transición.');
    const previous = preferences.settings;
    preferences.settings = validateSettings(input);
    try { await preferences.persist(); } catch (e) { preferences.settings = previous; throw e; }
    registerShortcuts(); broadcastCamera(); return config();
  }, true);
  handle('validate-shortcuts', input => checkShortcuts(input), true);
  handle('choose-folder', async () => {
    if (!['idle', 'finished'].includes(state.phase)) throw new Error('Cambia la carpeta cuando termine la grabación.');
    if (storage.list().some(r => !r.saved)) throw new Error('Guarda o descarta los borradores antes de cambiar de carpeta.');
    const result = await dialog.showOpenDialog(windows.main, { properties: ['openDirectory', 'createDirectory'], defaultPath: preferences.root });
    if (result.canceled) return null;
    const folder = path.resolve(result.filePaths[0]); const next = new RecordingStore(folder); await next.init();
    const previous = preferences.root; preferences.root = folder;
    try { await preferences.persist(); } catch (e) { preferences.root = previous; throw e; }
    setStore(next); return folder;
  }, true);
  handle('sources', async () => {
    // Area selection can display a screen preview at up to 720 CSS pixels wide.
    // Supplying a 1440 px thumbnail keeps it sharp on a 2x display instead of
    // stretching the former 320x180 source. Window cards stay lightweight.
    const [screens, windowSources] = await Promise.all([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1440, height: 900 } }),
      desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
    ]);
    const displays = screen.getAllDisplays();
    return [...screens, ...windowSources].filter(source => !source.name.startsWith('Tomixel')).map(source => {
      const display = displays.find(item => String(item.id) === source.display_id);
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        icon: source.appIcon?.toDataURL(),
        displayId: source.display_id,
        width: display ? Math.round(display.size.width * display.scaleFactor) : undefined,
        height: display ? Math.round(display.size.height * display.scaleFactor) : undefined
      };
    });
  });
  handle('select-source', async (id, audio) => {
    if (typeof id !== 'string' || !/^(screen|window):[\d:]+$/.test(id) || typeof audio !== 'boolean') throw new Error('Fuente inválida.');
    // Windows applies WDA_EXCLUDEFROMCAPTURE on the next desktop composition.
    // Give the protected teleprompter a composition turn before getDisplayMedia starts.
    windows.prepareForCapture();
    selection = { id, audio, expires: Date.now() + 15000 };
    await new Promise(resolve => setTimeout(resolve, 180));
  });
  handle('begin', () => storage.begin(), true);
  handle('abort', id => storage.abort(id), true);
  handle('append', (id, chunk) => storage.append(id, chunk), true);
  handle('finish', (id, duration) => storage.finish(id, duration), true);
  handle('save', async (id, title) => { const r = await storage.save(id, title); if (preferences.settings.openAfterSave) shell.showItemInFolder(storage.getPath(id)); return r; }, true);
  handle('discard-restart', async id => {
    if (state.phase !== 'finished') throw new Error('La toma todavía no está lista para reiniciarse.');
    const recording = storage.list().find(item => item.id === id);
    if (!recording) throw new Error('Grabación no encontrada.');
    const newest = storage.list()[0];
    if (newest?.id !== recording.id || Date.now() - Date.parse(recording.createdAt) > 5 * 60_000) throw new Error('Solo se puede reiniciar la toma recién finalizada.');
    return storage.remove(id);
  }, true);
  handle('save-edits', (id, cuts) => storage.saveEdits(id, cuts), true);
  handle('save-screenshot', async (id, png) => {
    const recording = storage.list().find(r => r.id === id); if (!recording) throw new Error('Grabación no encontrada.');
    if (!(png instanceof ArrayBuffer) || png.byteLength < 8 || png.byteLength > 32 * 1024 * 1024) throw new Error('Captura inválida.');
    const data = Buffer.from(png);
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('La captura no es un PNG válido.');
    const choice = await dialog.showSaveDialog(windows.main, { title: 'Guardar captura', defaultPath: path.join(preferences.root, 'recordings', `${recording.title.replace(/[<>:"/\\|?*]/g, ' ').trim()}_${Date.now()}.png`), filters: [{ name: 'Imagen PNG', extensions: ['png'] }] });
    if (choice.canceled || !choice.filePath) return null;
    const target = choice.filePath.endsWith('.png') ? choice.filePath : `${choice.filePath}.png`;
    await fs.writeFile(target, data); return target;
  }, true);
  handle('copy-screenshot', async png => {
    if (!(png instanceof ArrayBuffer) || png.byteLength < 8 || png.byteLength > 32 * 1024 * 1024) throw new Error('Captura inválida.');
    const data = Buffer.from(png);
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('La captura no es un PNG válido.');
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) throw new Error('No se pudo preparar la captura.');
    clipboard.writeImage(image);
    return true;
  }, true);
  handle('library', () => storage.list());
  handle('rename', (id, title) => storage.rename(id, title), true);
  const remove = async (id: string) => {
    const r = storage.list().find(r => r.id === id); if (!r) throw new Error('Grabación no encontrada.');
    const answer = await dialog.showMessageBox(windows.main, { type: 'warning', message: `¿Eliminar “${r.title}”?`, detail: 'El archivo se eliminará de este equipo.', buttons: ['Cancelar', 'Eliminar'], defaultId: 0, cancelId: 0 });
    return answer.response === 1 ? storage.remove(id) : false;
  };
  handle('remove', remove, true); handle('discard', remove, true);
  handle('remove-many', async ids => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string')) throw new Error('Selección inválida.');
    const unique = [...new Set(ids)];
    if (unique.some(id => !storage.list().some(r => r.id === id))) throw new Error('Una grabación seleccionada ya no existe.');
    const answer = await dialog.showMessageBox(windows.main, { type: 'warning', message: `¿Eliminar ${unique.length} grabaciones?`, detail: 'Los archivos se eliminarán de este equipo.', buttons: ['Cancelar', 'Eliminar'], defaultId: 0, cancelId: 0 });
    if (answer.response !== 1) return 0;
    for (const id of unique) await storage.remove(id);
    return unique.length;
  }, true);
  handle('thumbnail', async id => { const image = await nativeImage.createThumbnailFromPath(storage.getPath(id), { width: 192, height: 108 }); return image.isEmpty() ? null : image.toDataURL(); });
  handle('editor-proxy', async id => {
    const recording = storage.list().find(r => r.id === id); if (!recording) throw new Error('Grabación no encontrada.');
    await prepareEditorProxy(storage, recording, (percent, stage) => windows.main.webContents.send('editor-progress', { id, percent, stage }));
    return `lr-media://editor/${recording.id}`;
  }, true);
  handle('export-mp4', async (id, title, cuts, duration) => {
    const recording = storage.list().find(r => r.id === id); if (!recording) throw new Error('Grabación no encontrada.');
    return exportMp4(storage, recording, title, cuts, duration, preferences.settings.captureResolution);
  }, true);
  handle('storage-stats', async () => { const stats = await fs.statfs(preferences.root); return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize }; });
  handle('cursor', displayId => {
    if (typeof displayId !== 'string' || displayId.length > 40) throw new Error('Pantalla inválida.');
    const point = screen.getCursorScreenPoint();
    const display = screen.getAllDisplays().find(d => String(d.id) === displayId) || screen.getDisplayNearestPoint(point);
    const { x, y, width, height } = display.bounds;
    return { x: (point.x - x) / width, y: (point.y - y) / height, visible: point.x >= x && point.x < x + width && point.y >= y && point.y < y + height, click: clickMonitor.click, zoom: clickMonitor.zoom };
  });
  handle('open-folder', async id => { if (id !== undefined) shell.showItemInFolder(storage.getPath(id)); else { const error = await shell.openPath(path.join(preferences.root, 'recordings')); if (error) throw new Error(error); } });
  handle('status', value => {
    if (!value || !['idle', 'preparing', 'countdown', 'recording', 'paused', 'finishing', 'finished'].includes(value.phase) || !Number.isFinite(value.elapsed) || value.elapsed < 0 || typeof value.mic !== 'boolean' || typeof value.camera !== 'boolean') throw new Error('Estado inválido.');
    setStatus(value);
  });
  handle('layout', page => windows.layout(page, preferences.settings));
  handle('stage-layout', page => {
    if (typeof page !== 'string' || !['home', 'settings', 'library', 'sources', 'preview', 'help', 'controller', 'controller-zoom', 'countdown'].includes(page)) throw new Error('Diseño inválido.');
    windows.stageLayout(page, preferences.settings);
  });
  handle('reveal-layout', () => windows.revealLayout());
  handle('bubble', (show, fullscreen = false) => { if (typeof show !== 'boolean' || typeof fullscreen !== 'boolean') throw new Error('Estado inválido.'); windows.showBubble(show, preferences.settings, fullscreen); });
  handle('close', () => windows.main.close()); handle('minimize', () => windows.main.minimize());
  handle('exit-ready', () => { if (!['idle', 'finished'].includes(state.phase)) throw new Error('Grabación aún activa.'); exitReady(); });
}
