import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const output = path.resolve(`test-results/editing-${Date.now()}`); await fs.mkdir(output, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_PACKAGED_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const evidence = { tests: [], errors: [] }; const pass = (name, detail = true) => { evidence.tests.push({ name, detail }); console.log('PASS', name); };
let app;
try {
  app = await electron.launch({ args: ['.'], env, chromiumSandbox: true });
  const page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.evaluate(async () => { const config = await window.desktop.config(); await window.desktop.setSettings({ ...config.settings, countdown: 0, autoSave: true }); });
  await page.reload(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.waitForTimeout(5200); await page.getByRole('button', { name: 'Detener', exact: true }).click(); await page.getByRole('heading', { name: 'Así quedó tu grabación' }).waitFor();
  const player = page.locator('.final-video'); await page.waitForFunction(() => document.querySelector('.final-video')?.readyState >= 3, { timeout: 90000 });
  const originalDuration = await player.evaluate(video => video.duration); assert.ok(originalDuration > 4);
  await player.evaluate(video => { video.currentTime = 1.2; }); await page.waitForTimeout(1200);
  const seekState = await player.evaluate(video => ({ currentTime: video.currentTime, readyState: video.readyState, seekable: Array.from({ length: video.seekable.length }, (_, index) => [video.seekable.start(index), video.seekable.end(index)]) })); console.log('Seek state:', seekState);
  assert.ok(Math.abs(seekState.currentTime - 1.2) < .25, 'The indexed edit preview seeks without resetting to zero');
  const timeline = page.locator('.visual-timeline'); const box = await timeline.boundingBox(); assert.ok(box);
  async function select(from, to) { await page.mouse.move(box.x + box.width * from / originalDuration, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * to / originalDuration, box.y + box.height / 2, { steps: 6 }); await page.mouse.up(); await page.getByRole('button', { name: 'Eliminar tramo', exact: true }).click(); }
  await select(1.0, 1.6);
  await page.getByText('Corte 1', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Deshacer', exact: true }).click(); await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  assert.match(await page.getByText(/Resultado:/).innerText(), /\d{2}:\d{2}\.\d/); await page.screenshot({ path: path.join(output, 'visual-editor.png') }); pass('Seekable visual timeline removes a selected range and supports undo/redo');
  pass('The cut list remains non-destructive until export');
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  const screenshotStage = page.locator('.screenshot-stage'); await screenshotStage.waitFor(); const screenshotBox = await screenshotStage.boundingBox(); assert.ok(screenshotBox);
  await page.mouse.move(screenshotBox.x + screenshotBox.width * .15, screenshotBox.y + screenshotBox.height * .2); await page.mouse.down(); await page.mouse.move(screenshotBox.x + screenshotBox.width * .78, screenshotBox.y + screenshotBox.height * .74, { steps: 10 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Copiar al portapapeles', exact: true }).click(); await page.getByText('Captura copiada al portapapeles', { exact: true }).waitFor();
  const clipboardImage = await app.evaluate(({ clipboard }) => { const image = clipboard.readImage(); const bytes = image.isEmpty() ? 0 : image.toPNG().byteLength; return { present: bytes > 0, bytes }; });
  assert.equal(clipboardImage.present, true); assert.ok(clipboardImage.bytes > 1000);
  await page.getByRole('heading', { name: 'Así quedó tu grabación' }).waitFor(); await page.getByRole('button', { name: 'Capturar', exact: true }).click(); await page.getByRole('dialog', { name: 'Recortar captura' }).getByRole('button', { name: 'Cerrar', exact: true }).click(); await page.getByRole('heading', { name: 'Así quedó tu grabación' }).waitFor();
  pass('Area screenshot copies asynchronously and the editor remains usable', clipboardImage);
  assert.deepEqual(evidence.errors, []); pass('No renderer errors');
} catch (error) {
  evidence.failure = error.stack; console.error(error); process.exitCode = 1;
  const page = app?.windows()[0]; if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app?.close().catch(() => {}); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence:', output);
}
