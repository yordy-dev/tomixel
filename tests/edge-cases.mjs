import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const output = path.resolve(`test-results/edges-${Date.now()}`); await fs.mkdir(output, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_PACKAGED_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
function sendShortcut(key) {
  const code = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LRKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [LRKeys]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [LRKeys]::keybd_event(${key},0,0,[UIntPtr]::Zero); [LRKeys]::keybd_event(${key},0,2,[UIntPtr]::Zero); [LRKeys]::keybd_event(0x11,0,2,[UIntPtr]::Zero)`;
  const encoded = Buffer.from(code, 'utf16le').toString('base64'); const root = process.env.SystemRoot || 'C:\\Windows';
  const result = spawnSync(path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
  if (result.status) throw new Error(result.stderr.toString());
}
const evidence = []; let app;
const pass = name => { evidence.push(name); console.log('PASS', name); };
try {
  const executablePath = process.env.LOCAL_RECORDER_EXECUTABLE;
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('button', { name: 'Cancelar', exact: true }).waitFor(); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.waitForTimeout(3600); assert.equal((await page.evaluate(() => window.desktop.library())).length, 0); pass('Countdown cancellation leaves no draft and can restart');
  await page.getByRole('button', { name: /Qué quieres grabar/ }).click(); await page.getByRole('button', { name: 'Volver', exact: true }).click(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor(); pass('Source picker cancellation');
  const invalid = await page.evaluate(async () => { const config = await window.desktop.config(); const results = []; for (const op of [() => window.desktop.rename('../not-allowed', 'x'), () => window.desktop.selectSource('file:///C:/Windows', true), () => window.desktop.setSettings({ ...config.settings, micGain: 20 })]) { try { await op(); results.push(false); } catch { results.push(true); } } return results; }); assert.ok(invalid.every(Boolean)); pass('Invalid IPC input rejected');
  await page.evaluate(async () => { const c = await window.desktop.config(); await window.desktop.setSettings({ ...c.settings, countdown: 0, autoSave: true }); });
  await page.reload(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.waitForTimeout(1300); await page.getByRole('button', { name: 'Detener', exact: true }).click(); await page.getByText('Guardado', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.final-video')?.readyState >= 1); const video = await page.locator('.final-video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration })); assert.ok(video.width > 0 && Number.isFinite(video.duration)); pass('Screen recording and automatic save');
  await page.getByRole('button', { name: 'Grabar otra vez', exact: true }).click({ force: true }); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  const registered = await app.evaluate(({ globalShortcut }) => ['Control+R', 'Control+P', 'Control+M', 'Control+1', 'Control+2', 'Control+Q', 'Control+W', 'Control+E', 'Control+I'].every(s => globalShortcut.isRegistered(s))); assert.ok(registered); pass('Nine distinct two-key global shortcuts registered, including four camera actions');
  sendShortcut(0x57); await page.waitForFunction(async () => (await window.desktop.config()).settings.size === 'medium');
  sendShortcut(0x45); await page.waitForFunction(async () => (await window.desktop.config()).settings.cameraView === 'fullscreen');
  sendShortcut(0x45); await page.waitForFunction(async () => (await window.desktop.config()).settings.cameraView === 'bubble');
  sendShortcut(0x51); await page.waitForFunction(async () => (await window.desktop.config()).settings.size === 'small'); pass('Physical Ctrl+Q/W/E shortcuts work before recording');
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Tomixel' && !w.webContents.getURL().includes('#'));
    globalThis.__localRecorderCloseEvents = [];
    for (const name of ['close', 'hide', 'show', 'blur']) window.on(name, () => globalThis.__localRecorderCloseEvents.push({ name, visible: window.isVisible(), time: Date.now() }));
    window.close();
  });
  await page.waitForTimeout(400);
  const closeState = await app.evaluate(({ BrowserWindow }) => ({ visible: BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Tomixel' && !w.webContents.getURL().includes('#')).isVisible(), events: globalThis.__localRecorderCloseEvents }));
  if (closeState.visible) console.error('Close diagnostic:', closeState.events);
  assert.equal(closeState.visible, false); pass('Close hides the app while recording');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Tomixel' && !w.webContents.getURL().includes('#')); win.show(); win.focus(); });
  await page.waitForTimeout(300); assert.ok(await page.getByRole('button', { name: 'Pausar', exact: true }).isVisible()); pass('Restoring the app preserves active recording');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Detener', exact: true }).click(); await page.getByText('Guardado', { exact: true }).waitFor();
  const data = JSON.parse(await fs.readFile(path.join(output, 'profile/videos/recordings.json'), 'utf8')); assert.equal(data.length, 2); assert.ok(data.every(r => r.saved && r.size > 0)); pass('Closing to tray does not lose the active recording');
  sendShortcut(0x57); await page.waitForFunction(async () => (await window.desktop.config()).settings.size === 'medium');
  sendShortcut(0x45); await page.waitForFunction(async () => (await window.desktop.config()).settings.cameraView === 'fullscreen');
  sendShortcut(0x45); await page.waitForFunction(async () => (await window.desktop.config()).settings.cameraView === 'bubble');
  sendShortcut(0x51); await page.waitForFunction(async () => (await window.desktop.config()).settings.size === 'small'); pass('Physical Ctrl+Q/W/E shortcuts work after recording');
} catch (e) { evidence.push({ failure: e.stack }); console.error(e); process.exitCode = 1; }
finally { if (app) await app.close(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence:', output); }
