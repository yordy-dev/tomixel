import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
await fs.mkdir('test-results', { recursive: true });
await build({ stdin: { contents: 'export { RecordingStore, validTitle } from "./electron/main/storage"; export { validateSettings } from "./electron/main/settings"; export { defaults, shortcutCommands } from "./shared/types"; export { reserveDuration } from "./electron/main/webm"; export { normalizeCuts, keptSegments } from "./electron/main/cuts"; export { mergeCuts, skipRemovedTime } from "./src/services/editor"; export { masterSize, deliverySize, sharpZoomLimit, recordingBitrate } from "./src/services/media-quality";', resolveDir: process.cwd() }, outfile: 'test-results/storage-unit.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const { RecordingStore, validTitle, validateSettings, defaults, shortcutCommands, reserveDuration, normalizeCuts, keptSegments, mergeCuts, skipRemovedTime, masterSize, deliverySize, sharpZoomLimit, recordingBitrate } = createRequire(import.meta.url)('../test-results/storage-unit.cjs');
test('Recording lifecycle: ordered chunks, restart, rename, save and delete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-recorder-unit-'));
  const store = new RecordingStore(root); await store.init();
  const id = await store.begin(); await assert.rejects(store.begin());
  await store.append(id, Uint8Array.from([1, 2, 3]).buffer); await store.append(id, Uint8Array.from([4, 5, 6]).buffer);
  await assert.rejects(store.append('../escape', new ArrayBuffer(0)));
  const draft = await store.finish(id, 4.2); assert.equal(draft.size, 6);
  assert.deepEqual([...await fs.readFile(store.getPath(id))], [1, 2, 3, 4, 5, 6]);
  const restarted = new RecordingStore(root); await restarted.init(); assert.equal(restarted.list().length, 1);
  await restarted.saveEdits(id, [{ start: .5, end: 1.25 }]);
  await restarted.save(id, 'A real local file'); await restarted.rename(id, 'Renamed');
  const last = new RecordingStore(root); await last.init(); assert.equal(last.list()[0].title, 'Renamed'); assert.equal(last.list()[0].saved, true); assert.deepEqual(last.list()[0].cuts, [{ start: .5, end: 1.25 }]);
  const file = last.getPath(id);
  await last.remove(id); await assert.rejects(fs.stat(file)); assert.equal(last.list().length, 0);
});
test('IPC preference validation rejects invalid values and duplicate shortcuts', () => {
  assert.deepEqual(validateSettings(defaults), defaults);
  for (const patch of [{ micGain: Infinity }, { micGain: -1 }, { systemGain: Infinity }, { systemGain: -.1 }, { systemGain: 1.1 }, { screenFps: 240 }, { theme: 'invalid' }, { micEnabled: 'yes' }, { micId: 'a'.repeat(600) }, { shortcuts: { ...defaults.shortcuts, record: 'Ctrl+R', zoom150: 'Ctrl+R' } }, { shortcuts: { ...defaults.shortcuts, zoom150: 'Ctrl+Shift+1' } }, { shortcuts: { ...defaults.shortcuts, zoom150: 'A' } }, { cameraView: 'invalid' }, { cameraView: 'image', cameraImage: '' }, { cameraImage: 'https://example.com/remote.png' }, { cameraImage: 'data:image/svg+xml,<svg />' }, { cameraBackground: 'invalid' }, { cameraBackground: 'image', cameraBackgroundImage: '' }, { cameraBackgroundImage: 'https://example.com/remote.jpg' }, { cameraBrightness: 51 }, { cameraContrast: -51 }, { cameraTemperature: 0.5 }, { cameraSaturation: Infinity }, { fullscreenScale: 55 }, { fullscreenScale: 0 }]) assert.throws(() => validateSettings({ ...defaults, ...patch }));
  assert.throws(() => validTitle('')); assert.throws(() => validTitle('a\nnew line'));
});
test('Every saved shortcut name maps to the renderer command it must execute', () => {
  assert.deepEqual(Object.keys(shortcutCommands).sort(), Object.keys(defaults.shortcuts).sort());
  assert.deepEqual(shortcutCommands, {
    record: 'record', pause: 'pause', mic: 'mic', zoom150: 'zoom150', zoom200: 'zoom200',
    cameraSmall: 'camera-small', cameraMedium: 'camera-medium', cameraFullscreen: 'camera-fullscreen', cameraImage: 'camera-image'
  });
});
test('Native master, MP4 delivery and zoom detail limits remain independent', () => {
  assert.deepEqual(masterSize(3840, 2160), { width: 3840, height: 2160 });
  assert.deepEqual(deliverySize(3840, 2160, '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(deliverySize(3840, 2160, '1440p'), { width: 2560, height: 1440 });
  assert.equal(sharpZoomLimit(3840, 2160, 1920, 1080), 200);
  assert.equal(sharpZoomLimit(1920, 1080, 1920, 1080), 100);
  assert.ok(recordingBitrate(3840, 2160, 60, 'high') > recordingBitrate(1920, 1080, 30, 'high'));
  assert.ok(recordingBitrate(7680, 4320, 60, 'very-high') <= 80e6);
});
test('Multiple cut ranges merge safely and preserve the remaining segments', () => {
  const cuts = normalizeCuts([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 1.8, end: 3 }], 10);
  assert.deepEqual(cuts, [{ start: 1, end: 3 }, { start: 5, end: 6 }]);
  assert.deepEqual(keptSegments(cuts, 10), [{ start: 0, end: 1 }, { start: 3, end: 5 }, { start: 6, end: 10 }]);
  assert.deepEqual(mergeCuts([{ start: 2, end: 3 }, { start: 1, end: 2.02 }]), [{ start: 1, end: 3 }]);
  assert.equal(skipRemovedTime(1.5, cuts), 3); assert.equal(skipRemovedTime(4, cuts), 4);
  assert.throws(() => normalizeCuts([{ start: -1, end: 2 }], 10));
  assert.throws(() => keptSegments([{ start: 0, end: 10 }], 10));
});
test('Orphan recording recovery and malicious index filename filtering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-recorder-recovery-'));
  const store = new RecordingStore(root); await store.init(); const id = await store.begin(); await store.append(id, Uint8Array.from([1, 2]).buffer); await store.closeHandles();
  const recovered = new RecordingStore(root); await recovered.init(); assert.equal(recovered.list().length, 1); assert.equal(recovered.list()[0].saved, false);
  const bad = { ...recovered.list()[0], filename: '../outside.webm' }; await fs.writeFile(path.join(root, 'recordings.json'), JSON.stringify([bad]));
  const safe = new RecordingStore(root); await safe.init(); assert.ok(safe.list().every(r => !r.filename.includes('/')));
});
test('WebM duration is inserted into real Chromium header, without buffering video', async () => {
  const header = Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701ffffffffffffff1549a966992ad7b1830f42404d80864368726f6d655741864368726f6d651654ae6b80', 'hex');
  const patch = reserveDuration(header); assert.ok(patch); assert.equal(patch.buffer.length, header.length + 11); assert.equal(patch.scale, 1e6);
  assert.equal(reserveDuration(Buffer.from([1, 2, 3])), null);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-recorder-webm-')); const store = new RecordingStore(root); await store.init();
  const id = await store.begin(); await store.append(id, Uint8Array.from(header).buffer); await store.finish(id, 12.5);
  const data = await fs.readFile(store.getPath(id)); assert.equal(data.readDoubleBE(patch.offset), 12500);
});
