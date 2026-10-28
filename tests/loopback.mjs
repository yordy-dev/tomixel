import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve(`test-results/loopback-${Date.now()}`); await fs.mkdir(output, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_PACKAGED_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, chromiumSandbox: true });
const evidence = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.evaluate(async () => { const config = await window.desktop.config(); await window.desktop.setSettings({ ...config.settings, micEnabled: false, cameraEnabled: false, systemAudio: true, countdown: 0, autoSave: true }); });
  await page.reload(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ width: 520, height: 280, x: 50, y: 50, title: 'Loopback QA', webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,' + encodeURIComponent('<title>Loopback QA</title><body style="background:#196663;color:white;font:28px Segoe UI;padding:30px">Prueba de audio de Windows<br><small>Tono de prueba local · 440 Hz</small></body>'));
    await win.webContents.executeJavaScript("window.toneContext = new AudioContext(); window.tone = toneContext.createOscillator(); window.volume = toneContext.createGain(); tone.frequency.value = 440; volume.gain.value = 0.15; tone.connect(volume).connect(toneContext.destination); tone.start(); toneContext.resume();", true);
  });
  await page.addInitScript(() => { const get = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getDisplayMedia = async c => { const s = await get(c); window.__captured = s; return s; }; });
  await page.reload(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  const tracks = await page.evaluate(() => window.__captured.getTracks().map(t => ({ kind: t.kind, settings: t.getSettings() })));
  evidence.push({ test: 'Windows getDisplayMedia real tracks', tracks }); assert.ok(tracks.some(t => t.kind === 'audio'));
  await page.waitForTimeout(3200); await page.getByRole('button', { name: 'Detener', exact: true }).click(); await page.getByText('Guardado', { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Loopback QA')?.destroy(); });
  const [recording] = await page.evaluate(() => window.desktop.library()); assert.equal(recording.saved, true);
  const file = path.join(output, 'profile/videos/recordings', recording.filename);
  const samples = await page.evaluate(async data => {
    const context = new AudioContext();
    try { const audio = await context.decodeAudioData(Uint8Array.from(data).buffer); const channel = audio.getChannelData(0); let sum = 0, peak = 0, re = 0, im = 0; for (let i = 0; i < channel.length; i++) { const value = channel[i]; sum += value * value; peak = Math.max(peak, Math.abs(value)); re += value * Math.cos(2 * Math.PI * 440 * i / audio.sampleRate); im += value * Math.sin(2 * Math.PI * 440 * i / audio.sampleRate); } return { duration: audio.duration, rms: Math.sqrt(sum / channel.length), peak, tone440: Math.sqrt(re * re + im * im) / channel.length, channels: audio.numberOfChannels }; }
    finally { await context.close(); }
  }, [...await fs.readFile(file)]);
  assert.ok(samples.rms > .001, 'Loopback must contain actual sound'); assert.ok(samples.tone440 > .001, 'Recorded system audio must contain test tone, not a silent track'); assert.ok(samples.peak < .98, 'Clean mix must remain below digital clipping'); evidence.push({ test: '440 Hz speaker tone found below clipping in saved WebM, microphone disabled', samples });
  const video = page.locator('.final-video'); await page.waitForFunction(() => document.querySelector('.final-video').readyState >= 1);
  const duration = await video.evaluate(v => v.duration); assert.ok(Number.isFinite(duration) && duration > 1); evidence.push({ test: 'WebM has finite duration', duration });
  await page.getByRole('button', { name: 'Abrir ubicación', exact: true }).click(); evidence.push({ test: 'Native showItemInFolder invoked on saved file' });
  console.log(JSON.stringify(evidence, null, 2));
} catch (e) { console.error(e); evidence.push({ failure: e.stack }); process.exitCode = 1; const page = app.windows().find(p => p.url().startsWith('file:')); if (page) console.log(await page.locator('body').innerText()); }
finally { await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); await app.close(); console.log('Evidence:', output); }
