import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.resolve(`test-results/packaged-profile-${Date.now()}`) }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/Tomixel.exe'), args: [], env, chromiumSandbox: true });
const errors = [], evidence = {};
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(25000); page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  evidence.application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), configPath: app.getPath('userData') })); assert.equal(evidence.application.packaged, true);
  evidence.config = await page.evaluate(() => window.desktop.config());
  await page.getByRole('button', { name: /Qué quieres grabar/ }).click();
  await page.getByRole('button', { name: 'Seleccionar área', exact: true }).click();
  const areaPreview = page.getByRole('img', { name: 'Vista previa para seleccionar el área de grabación' }); await areaPreview.waitFor();
  evidence.areaPreview = await areaPreview.locator('img').evaluate(image => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, renderedWidth: image.getBoundingClientRect().width, pixelRatio: devicePixelRatio }));
  assert.ok(evidence.areaPreview.naturalWidth >= evidence.areaPreview.renderedWidth * Math.min(2, evidence.areaPreview.pixelRatio) * .95);
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await app.context().setOffline(true);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click(); await page.getByText(/GTCRN activo/).waitFor(); evidence.gtcrnActiveOffline = true;
  await page.getByRole('button', { name: 'Cámara', exact: true }).click(); await page.getByLabel('Efecto de fondo').selectOption('blur-soft');
  await page.waitForFunction(() => ['Óptimo', 'Limitado'].includes(document.querySelector('.camera-performance')?.textContent || ''), null, { timeout: 30000 }); evidence.cameraEffectsOffline = true;
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.screenshot({ path: 'test-results/final-panel.png' });
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor(); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Detener', exact: true }).click(); await page.getByRole('heading', { name: 'Así quedó tu grabación' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.final-video')?.readyState >= 1);
  await page.locator('.final-video').evaluate(v => v.play()); await page.waitForTimeout(500);
  evidence.playback = await page.locator('.final-video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, time: v.currentTime })); assert.ok(evidence.playback.time > 0);
  evidence.noNetworkRequired = true;
  await page.locator('.final-video').evaluate(v => v.pause());
  const mp4Path = path.resolve('test-results/packaged-export.mp4'); await fs.rm(mp4Path, { force: true });
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, mp4Path);
  await page.getByRole('button', { name: 'Exportar MP4', exact: true }).click(); await page.getByText(/MP4 exportado:/).waitFor({ timeout: 60000 });
  const mp4 = await fs.readFile(mp4Path); evidence.mp4 = { size: mp4.length, header: mp4.subarray(4, 8).toString() }; assert.ok(mp4.length > 10000 && mp4.subarray(0, 32).includes(Buffer.from('ftyp')));
  // Delete only the temporary test recording through the application's confirmation path.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await page.getByRole('button', { name: 'Descartar grabación', exact: true }).click(); await page.getByRole('heading', { name: 'Tus grabaciones' }).waitFor();
  assert.deepEqual(errors, []); evidence.errors = errors; console.log('PASS packaged executable records, plays and exports MP4 offline', evidence.application, evidence.playback, evidence.mp4);
} catch (e) { evidence.failure = e.stack; console.error(e); process.exitCode = 1; }
finally { await fs.writeFile('test-results/packaged.json', JSON.stringify(evidence, null, 2)); await app.close(); }
