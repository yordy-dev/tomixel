import { dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { CutRange, Recording, Settings } from '../../shared/types';
import { validTitle, type RecordingStore } from './storage';
import { keptSegments, normalizeCuts } from './cuts';

function ffmpegPath() {
  if (!ffmpegStatic) throw new Error('El conversor MP4 no está disponible.');
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}
function safeFilename(title: string) {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Grabación';
}
function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`No se pudo crear el MP4. ${stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`)));
  });
}
function hasAudio(file: string) {
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-40000); });
    child.on('error', reject);
    child.on('exit', () => resolve(/Stream #\d+:\d+(?:\([^)]*\))?: Audio:/.test(stderr)));
  });
}
function scaleFilter(resolution: Settings['captureResolution']) {
  if (resolution === 'native') return '';
  const limits = { '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] } as const;
  const [width, height] = limits[resolution];
  return `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}
function editFilter(segments: CutRange[], audio: boolean, scale: string) {
  const filters: string[] = [];
  for (const [index, segment] of segments.entries()) {
    const range = `start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)}`;
    filters.push(`[0:v:0]trim=${range},setpts=PTS-STARTPTS[v${index}]`);
    if (audio) filters.push(`[0:a:0]atrim=${range},asetpts=PTS-STARTPTS[a${index}]`);
  }
  const inputs = segments.map((_, index) => `[v${index}]${audio ? `[a${index}]` : ''}`).join('');
  filters.push(`${inputs}concat=n=${segments.length}:v=1:a=${audio ? 1 : 0}[vconcat]${audio ? '[aout]' : ''}`);
  filters.push(scale ? `[vconcat]${scale}[vout]` : '[vconcat]null[vout]');
  return filters.join(';');
}
export async function exportMp4(store: RecordingStore, recording: Recording, title: unknown, cutsInput: unknown, durationInput: unknown, resolution: Settings['captureResolution'] = '1080p') {
  const name = validTitle(title);
  if (typeof durationInput !== 'number' || !Number.isFinite(durationInput) || durationInput <= 0 || (recording.duration > 0 && durationInput > recording.duration + .5)) throw new Error('La duración del video no es válida.');
  const cuts = normalizeCuts(cutsInput, durationInput);
  const segments = keptSegments(cuts, durationInput);
  const choice = await dialog.showSaveDialog({
    title: 'Exportar como MP4',
    defaultPath: path.join(store.root, 'recordings', `${safeFilename(name)}.mp4`),
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
  });
  if (choice.canceled || !choice.filePath) return null;
  const destination = path.resolve(choice.filePath.endsWith('.mp4') ? choice.filePath : `${choice.filePath}.mp4`);
  const temporary = `${destination}.${Date.now()}.partial.mp4`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const input = store.getPath(recording.id);
    const scale = scaleFilter(resolution);
    const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-video_track_timescale', '90000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary];
    const resize = scale ? ['-vf', scale] : [];
    if (!cuts.length) await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', ...resize, ...encode]);
    else if (segments.length === 1) await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ss', segments[0].start.toFixed(3), '-t', (segments[0].end - segments[0].start).toFixed(3), '-map', '0:v:0', '-map', '0:a?', ...resize, ...encode]);
    else {
      const audio = await hasAudio(input);
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-filter_complex', editFilter(segments, audio, scale), '-map', '[vout]', ...(audio ? ['-map', '[aout]'] : []), ...encode]);
    }
    await fs.rm(destination, { force: true });
    await fs.rename(temporary, destination);
    return destination;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
