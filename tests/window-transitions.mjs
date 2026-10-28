import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const output = path.resolve(`test-results/window-transitions-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_PACKAGED_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.LOCAL_RECORDER_EXE;
const app = await electron.launch(executablePath ? { executablePath: path.resolve(executablePath), env, chromiumSandbox: true } : { args: ['.'], env, chromiumSandbox: true });

async function captureFrames(page, action, settled) {
  await page.evaluate(() => {
    window.__layoutFrames = [];
    window.__layoutSampling = true;
    const sample = () => {
      window.__layoutFrames.push({
        width: innerWidth,
        height: innerHeight,
        countdown: !!document.querySelector('.countdown-overlay'),
        controller: !!document.querySelector('.controller'),
        zoom: !!document.querySelector('.zoom-live')
      });
      if (window.__layoutSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await action(); await settled(); await page.waitForTimeout(160);
  return page.evaluate(() => { window.__layoutSampling = false; return window.__layoutFrames; });
}

try {
  const page = await app.firstWindow(); page.setDefaultTimeout(25000);
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  const skipTutorial = page.getByRole('button', { name: 'Omitir tutorial', exact: true });
  if (await skipTutorial.isVisible().catch(() => false)) await skipTutorial.click();
  await page.evaluate(async () => {
    const config = await window.desktop.config();
    await window.desktop.setSettings({ ...config.settings, countdown: 3, cameraEnabled: false, micEnabled: false });
  });
  await page.reload(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();

  const firstStart = await captureFrames(page,
    () => page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(),
    () => page.getByRole('timer').waitFor());
  assert.ok(firstStart.some(frame => frame.countdown), 'La primera cuenta regresiva no apareció.');
  assert.equal(firstStart.some(frame => frame.countdown && (frame.width < 1000 || frame.height < 700)), false, 'La cuenta regresiva se dibujó dentro de la ventana pequeña.');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();

  const secondStart = await captureFrames(page,
    () => page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(),
    () => page.getByRole('timer').waitFor());
  assert.equal(secondStart.some(frame => frame.countdown && (frame.width < 1000 || frame.height < 700)), false, 'La segunda cuenta regresiva se dibujó dentro de la ventana pequeña.');

  const controllerFrames = await captureFrames(page,
    () => page.getByRole('button', { name: 'Empezar ahora', exact: true }).click(),
    () => page.getByRole('button', { name: 'Pausar', exact: true }).waitFor());
  assert.equal(controllerFrames.some(frame => frame.controller && (frame.width !== 450 || frame.height !== 175)), false, 'El controlador se dibujó con dimensiones incorrectas.');
  const controllerBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))?.getBounds());

  const zoomFrames = await captureFrames(page,
    () => page.getByRole('button', { name: 'Zoom 100%', exact: true }).click(),
    () => page.getByRole('button', { name: 'Zoom 150%', exact: true }).waitFor());
  assert.equal(zoomFrames.some(frame => frame.zoom && (frame.width !== 560 || frame.height !== 475)), false, 'La vista ampliada se dibujó con dimensiones incorrectas.');
  for (const zoom of [150, 200, 250]) {
    await page.getByRole('button', { name: `Zoom ${zoom}%`, exact: true }).click();
    await page.getByRole('button', { name: `Zoom ${zoom + 50}%`, exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Zoom 300%', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom 100%', exact: true }).waitFor();
  await page.waitForTimeout(180);
  const restoredBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))?.getBounds());
  assert.deepEqual(restoredBounds, controllerBounds, 'El controlador no volvió a su tamaño y posición originales después del zoom.');

  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ firstStart, secondStart, controllerFrames, zoomFrames, controllerBounds, restoredBounds }, null, 2));
  console.log(`PASS window transitions: ${output}`);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
