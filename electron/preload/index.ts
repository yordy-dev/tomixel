import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../../shared/types';
function listen<T>(channel: string, fn: (value: T) => void) {
  const listener = (_: Electron.IpcRendererEvent, value: T) => fn(value);
  ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener);
}
const api: DesktopAPI = {
  config: () => ipcRenderer.invoke('config'), setSettings: s => ipcRenderer.invoke('settings', s), chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  validateShortcuts: s => ipcRenderer.invoke('validate-shortcuts', s),
  sources: () => ipcRenderer.invoke('sources'), selectSource: (id, audio) => ipcRenderer.invoke('select-source', id, audio),
  begin: () => ipcRenderer.invoke('begin'), abort: id => ipcRenderer.invoke('abort', id), append: (id, chunk) => ipcRenderer.invoke('append', id, chunk), finish: (id, duration) => ipcRenderer.invoke('finish', id, duration),
  save: (id, title) => ipcRenderer.invoke('save', id, title), discard: id => ipcRenderer.invoke('discard', id), discardRestart: id => ipcRenderer.invoke('discard-restart', id),
  saveEdits: (id, cuts) => ipcRenderer.invoke('save-edits', id, cuts), saveScreenshot: (id, png) => ipcRenderer.invoke('save-screenshot', id, png), copyScreenshot: png => ipcRenderer.invoke('copy-screenshot', png),
  library: () => ipcRenderer.invoke('library'), rename: (id, title) => ipcRenderer.invoke('rename', id, title), remove: id => ipcRenderer.invoke('remove', id), removeMany: ids => ipcRenderer.invoke('remove-many', ids),
  thumbnail: id => ipcRenderer.invoke('thumbnail', id), editorProxy: id => ipcRenderer.invoke('editor-proxy', id), exportMp4: (id, title, cuts, duration) => ipcRenderer.invoke('export-mp4', id, title, cuts, duration),
  cursor: displayId => ipcRenderer.invoke('cursor', displayId), storageStats: () => ipcRenderer.invoke('storage-stats'),
  openFolder: id => ipcRenderer.invoke('open-folder', id), status: s => ipcRenderer.invoke('status', s), layout: page => ipcRenderer.invoke('layout', page),
  stageLayout: page => ipcRenderer.invoke('stage-layout', page), revealLayout: () => ipcRenderer.invoke('reveal-layout'),
  close: () => ipcRenderer.invoke('close'), minimize: () => ipcRenderer.invoke('minimize'), bubble: (show, fullscreen) => ipcRenderer.invoke('bubble', show, fullscreen), bubbleConfig: () => ipcRenderer.invoke('bubble-config-current'),
  cameraAction: action => ipcRenderer.invoke('camera-action', action), chooseCameraImage: () => ipcRenderer.invoke('camera-image'), chooseCameraBackground: () => ipcRenderer.invoke('camera-background-image'),
  setFullscreenScale: value => ipcRenderer.invoke('camera-scale', value),
  moveBubble: delta => ipcRenderer.invoke('bubble-move', delta),
  cameraVideoReady: () => ipcRenderer.send('camera-video-ready'), cameraVideoPacket: packet => ipcRenderer.send('camera-video-packet', packet),
  showTeleprompter: () => ipcRenderer.invoke('teleprompter-show'), hideTeleprompter: () => ipcRenderer.invoke('teleprompter-hide'),
  onCommand: fn => listen('command', fn), onPosition: fn => listen('bubble-position', fn), onBubbleConfig: fn => listen('bubble-config', fn), onCameraVideoReady: fn => listen('camera-video-ready', fn), onCameraVideoPacket: fn => listen('camera-video-packet', fn), onTeleprompterVisibility: fn => listen('teleprompter-visibility', fn),
  onEditorProgress: fn => listen('editor-progress', fn), onNavigate: fn => listen('navigate', fn),
  exitReady: () => ipcRenderer.invoke('exit-ready')
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(api));
