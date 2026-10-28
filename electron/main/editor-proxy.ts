import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { Recording } from '../../shared/types';
import type { RecordingStore } from './storage';

const pending = new Map<string, Promise<string>>();
const paths = new Map<string, string>();

function ffmpegPath() {
  if (!ffmpegStatic) throw new Error('El conversor de la vista previa no está disponible.');
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}

function run(args: string[], duration: number, progress?: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { const text = chunk.toString(); stderr = (stderr + text).slice(-8000); const values = [...text.matchAll(/out_time_(?:ms|us)=(\d+)/g)]; if (values.length && duration > 0) progress?.(Math.min(99, Math.round(Number(values.at(-1)![1]) / 1e6 / duration * 100))); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`No se pudo preparar el editor. ${stderr.split(/\r?\n/).filter(Boolean).at(-1) || ''}`)));
  });
}

/** A disposable, indexed MP4 only for scrubbing in the editor. The WebM source remains untouched. */
export async function prepareEditorProxy(store: RecordingStore, recording: Recording, progress?: (percent: number, stage: string) => void) {
  const existing = paths.get(recording.id);
  if (existing) { progress?.(100, 'Vista previa lista'); return existing; }
  const inFlight = pending.get(recording.id);
  if (inFlight) return inFlight;
  const work = (async () => {
    const source = store.getPath(recording.id);
    const folder = path.join(app.getPath('temp'), 'LocalRecorder', 'editor-preview');
    const target = path.join(folder, `${recording.id}.mp4`);
    const partial = `${target}.${Date.now()}.partial.mp4`;
    await fs.mkdir(folder, { recursive: true });
    try {
      await fs.access(target);
    } catch {
      // A one-second keyframe interval makes arbitrary seeks predictable, while
      // the low-cost preview encode avoids slowing down the real MP4 export.
      progress?.(1, 'Indexando video');
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a?', '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-r', '30', '-fps_mode', 'cfr', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:2', '-nostats', partial], recording.duration, value => progress?.(value, 'Preparando búsqueda precisa'));
      await fs.rm(target, { force: true });
      await fs.rename(partial, target);
    } finally {
      await fs.rm(partial, { force: true }).catch(() => {});
    }
    paths.set(recording.id, target); progress?.(100, 'Vista previa lista');
    return target;
  })();
  pending.set(recording.id, work);
  try { return await work; } finally { pending.delete(recording.id); }
}

export function editorProxyPath(id: string) { return paths.get(id); }
