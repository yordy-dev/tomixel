import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { EditorMedia, Recording } from '../../shared/types';
import type { RecordingStore } from './storage';

const pending = new Map<string, Promise<EditorMedia>>();
const media = new Map<string, { video: string; waveform: string | null; fps: number }>();

function ffmpegPath() {
  if (!ffmpegStatic) throw new Error('El conversor de la vista previa no está disponible.');
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}

function cacheFolder() { return path.join(app.getPath('temp'), 'LocalRecorder', 'editor-preview'); }

function run(args: string[], duration: number, progress?: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { const text = chunk.toString(); stderr = (stderr + text).slice(-8000); const values = [...text.matchAll(/out_time_(?:ms|us)=(\d+)/g)]; if (values.length && duration > 0) progress?.(Math.min(99, Math.round(Number(values.at(-1)![1]) / 1e6 / duration * 100))); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`No se pudo preparar el editor. ${stderr.split(/\r?\n/).filter(Boolean).at(-1) || ''}`)));
  });
}

function probeFps(file: string) {
  return new Promise<number>(resolve => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-40000); });
    child.on('error', () => resolve(30));
    child.on('exit', () => {
      const line = stderr.split(/\r?\n/).find(value => /Video:/.test(value)) || '';
      const match = /(?:,|\s)(\d+(?:\.\d+)?)\s+fps(?:,|\s)/.exec(line);
      const value = Number(match?.[1]);
      resolve(Number.isFinite(value) && value >= 1 && value <= 240 ? value : 30);
    });
  });
}

async function waveformData(source: string, target: string) {
  try {
    await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x120:colors=0xf56549', '-frames:v', '1', target], 0);
    return `data:image/png;base64,${(await fs.readFile(target)).toString('base64')}`;
  } catch {
    await fs.rm(target, { force: true }).catch(() => {});
    return null;
  }
}

async function folderBytes(folder: string): Promise<number> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const sizes = await Promise.all(entries.map(async entry => entry.isDirectory() ? folderBytes(path.join(folder, entry.name)) : (await fs.stat(path.join(folder, entry.name))).size));
    return sizes.reduce((sum, value) => sum + value, 0);
  } catch { return 0; }
}

export async function clearEditorCache(id?: string) {
  const folder = cacheFolder();
  if (!id) {
    const removed = await folderBytes(folder);
    pending.clear(); media.clear();
    await fs.rm(folder, { recursive: true, force: true });
    return removed;
  }
  pending.delete(id); media.delete(id);
  const files = [path.join(folder, `${id}.mp4`), path.join(folder, `${id}.waveform.png`)];
  let removed = 0;
  for (const file of files) { try { removed += (await fs.stat(file)).size; } catch {} await fs.rm(file, { force: true }).catch(() => {}); }
  for (const name of await fs.readdir(folder).catch(() => [] as string[])) if (name.startsWith(`${id}.`) && name.includes('.partial')) await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
  return removed;
}

/** A disposable indexed MP4 and compact waveform for scrubbing. The WebM source remains untouched. */
export async function prepareEditorProxy(store: RecordingStore, recording: Recording, progress?: (percent: number, stage: string) => void): Promise<EditorMedia> {
  const existing = media.get(recording.id);
  if (existing) { progress?.(100, 'Vista previa lista'); return { url: `lr-media://editor/${recording.id}`, fps: existing.fps, waveform: existing.waveform }; }
  const inFlight = pending.get(recording.id);
  if (inFlight) return inFlight;
  const work = (async () => {
    const source = store.getPath(recording.id);
    const folder = cacheFolder();
    const target = path.join(folder, `${recording.id}.mp4`);
    const waveformFile = path.join(folder, `${recording.id}.waveform.png`);
    const partial = `${target}.${Date.now()}.partial.mp4`;
    await fs.mkdir(folder, { recursive: true });
    const disk = await fs.statfs(folder);
    if (disk.bavail * disk.bsize < Math.max(256 * 1024 * 1024, recording.size * 1.2)) throw new Error('No hay espacio temporal suficiente para preparar el editor. Limpia la caché o libera espacio en Windows.');
    const fps = await probeFps(source);
    const outputFps = Math.max(1, Math.min(120, fps));
    try {
      await fs.access(target);
    } catch {
      progress?.(1, 'Indexando video');
      const rate = String(Number(outputFps.toFixed(3))), gop = String(Math.max(1, Math.round(outputFps)));
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a?', '-vf', `fps=${rate}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-r', rate, '-fps_mode', 'cfr', '-g', gop, '-keyint_min', gop, '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:2', '-nostats', partial], recording.duration, value => progress?.(value, 'Preparando búsqueda precisa'));
      await fs.rm(target, { force: true });
      await fs.rename(partial, target);
    } finally {
      await fs.rm(partial, { force: true }).catch(() => {});
    }
    progress?.(99, 'Preparando forma de onda');
    const waveform = await waveformData(source, waveformFile);
    media.set(recording.id, { video: target, waveform, fps: outputFps });
    progress?.(100, 'Vista previa lista');
    return { url: `lr-media://editor/${recording.id}`, fps: outputFps, waveform };
  })();
  pending.set(recording.id, work);
  try { return await work; } finally { pending.delete(recording.id); }
}

export function editorProxyPath(id: string) { return media.get(id)?.video; }
