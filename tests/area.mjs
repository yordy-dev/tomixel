import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function sendCtrlWheel(delta) {
  const code = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LRInput { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, int data, UIntPtr extra); }'; [LRInput]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [LRInput]::mouse_event(0x0800,0,0,${delta},[UIntPtr]::Zero); [LRInput]::keybd_event(0x11,0,2,[UIntPtr]::Zero)`;
  const encoded = Buffer.from(code, 'utf16le').toString('base64'); const root = process.env.SystemRoot || 'C:\\Windows';
  const result = spawnSync(path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true }); if (result.status) throw new Error(result.stderr.toString());
}
function sendShortcut(key) {
  const code = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LRKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [LRKeys]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [LRKeys]::keybd_event(${key},0,0,[UIntPtr]::Zero); [LRKeys]::keybd_event(${key},0,2,[UIntPtr]::Zero); [LRKeys]::keybd_event(0x11,0,2,[UIntPtr]::Zero)`;
  const encoded = Buffer.from(code, 'utf16le').toString('base64'); const root = process.env.SystemRoot || 'C:\\Windows';
  const result = spawnSync(path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true }); if (result.status) throw new Error(result.stderr.toString());
}
function setCursorPosition(x, y) {
  const code = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class LRCursor { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'; [LRCursor]::SetCursorPos(${Math.round(x)},${Math.round(y)})`;
  const encoded = Buffer.from(code, 'utf16le').toString('base64'); const root = process.env.SystemRoot || 'C:\\Windows';
  const result = spawnSync(path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true }); if (result.status) throw new Error(result.stderr.toString());
}
async function videoSignature(video) {
  return video.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext('2d'); context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
  });
}

const output = path.resolve(`test-results/area-${Date.now()}`); await fs.mkdir(output, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_PACKAGED_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const evidence = { tests: [], errors: [] }; const pass = (name, detail = true) => { evidence.tests.push({ name, detail }); console.log('PASS', name); };
let app;
try {
  app = await electron.launch({ args: ['.'], env, chromiumSandbox: true });
  const page = await app.firstWindow(); page.setDefaultTimeout(25000); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.getByRole('button', { name: /Qué quieres grabar/ }).click();
  await page.getByRole('button', { name: 'Seleccionar área', exact: true }).click();
  const stage = page.getByRole('img', { name: 'Vista previa para seleccionar el área de grabación' }); await stage.waitFor();
  const previewQuality = await stage.locator('img').evaluate(image => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, renderedWidth: image.getBoundingClientRect().width, pixelRatio: devicePixelRatio }));
  assert.ok(previewQuality.naturalWidth >= previewQuality.renderedWidth * Math.min(2, previewQuality.pixelRatio) * .95, `Area preview is being enlarged: ${JSON.stringify(previewQuality)}`);
  await page.screenshot({ path: path.join(output, '01-area-empty.png') }); pass('Select area uses a high-density screen preview', previewQuality);
  const box = await stage.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * .18, box.y + box.height * .2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .78, box.y + box.height * .7, { steps: 8 }); await page.mouse.up();
  const selection = page.locator('.area-selection'); await selection.waitFor(); const selectedBox = await selection.boundingBox(); assert.ok(selectedBox);
  const expectedAspect = selectedBox.width / selectedBox.height;
  assert.match(await selection.innerText(), /^\d+ × \d+ px$/); assert.equal(await page.getByRole('button', { name: 'Usar esta área' }).isEnabled(), true);
  await page.screenshot({ path: path.join(output, '02-area-selected.png') }); pass('Drag creates a bounded area and enables confirmation', { expectedAspect });
  await page.getByRole('button', { name: 'Usar esta área' }).click(); await page.getByText(/Área seleccionada/).waitFor(); pass('Selected area returns to the recorder panel');
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click(); await page.getByRole('timer').waitFor();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor(); await page.waitForTimeout(1800);
  const display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
  sendShortcut(0x31); await page.getByRole('button', { name: 'Zoom 150%', exact: true }).waitFor({ timeout: 5000 });
  const shortcutLive = page.getByLabel('Vista en vivo del zoom grabado'); await shortcutLive.waitFor(); await page.waitForFunction(() => document.querySelector('.zoom-live-preview')?.videoWidth > 0); const transitionFrame = await videoSignature(shortcutLive); await page.waitForTimeout(750); const settledFrame = await videoSignature(shortcutLive); const transitionDifference = transitionFrame.reduce((sum, value, index) => sum + Math.abs(value - settledFrame[index]), 0) / transitionFrame.length; assert.ok(transitionDifference > .25); pass('150% shortcut enters zoom through a visible transition', { transitionDifference });
  sendShortcut(0x31); await page.getByRole('button', { name: 'Zoom 100%', exact: true }).waitFor({ timeout: 5000 });
  sendShortcut(0x32); await page.getByRole('button', { name: 'Zoom 200%', exact: true }).waitFor({ timeout: 5000 }); sendShortcut(0x32); await page.getByRole('button', { name: 'Zoom 100%', exact: true }).waitFor({ timeout: 5000 }); pass('150% and 200% shortcuts toggle their exact level and return to 100%');
  sendCtrlWheel(120);
  await page.getByRole('button', { name: 'Zoom 150%', exact: true }).waitFor({ timeout: 5000 });
  const live = page.getByLabel('Vista en vivo del zoom grabado'); await live.waitFor(); await page.waitForFunction(() => document.querySelector('.zoom-live-preview')?.videoWidth > 0);
  const liveState = await live.evaluate(video => ({ width: video.videoWidth, height: video.videoHeight, ready: video.readyState, windowWidth: innerWidth, windowHeight: innerHeight })); assert.ok(liveState.width > 0 && liveState.height > 0 && liveState.ready >= 2 && liveState.windowWidth >= 500);
  await page.getByRole('button', { name: 'Zoom 150%', exact: true }).click(); await page.getByRole('button', { name: 'Zoom 200%', exact: true }).waitFor(); await page.screenshot({ path: path.join(output, '03-live-zoom.png') }); pass('Ctrl + wheel and visible button advance the recorded zoom in 50% steps', liveState);
  setCursorPosition(display.x + display.width * .25, display.y + display.height * .3); await page.waitForTimeout(900);
  const leftFrame = await videoSignature(live); await live.screenshot({ path: path.join(output, '04-zoom-follows-left.png') });
  setCursorPosition(display.x + display.width * .7, display.y + display.height * .6); await page.waitForTimeout(900);
  const rightFrame = await videoSignature(live); await live.screenshot({ path: path.join(output, '05-zoom-follows-right.png') });
  const frameDifference = leftFrame.reduce((sum, value, index) => sum + Math.abs(value - rightFrame[index]), 0) / leftFrame.length;
  assert.ok(frameDifference > 2, `Expected the zoomed frame to follow the cursor; frame difference was ${frameDifference}`);
  pass('Zoomed recording view follows cursor movement smoothly', { frameDifference });
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Detener', exact: true }).click(); await page.getByRole('heading', { name: 'Así quedó tu grabación' }).waitFor();
  const player = page.locator('.final-video'); await page.waitForFunction(() => document.querySelector('.final-video')?.readyState >= 1);
  const dimensions = await player.evaluate(video => ({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
  assert.ok(dimensions.width > 0 && dimensions.height > 0 && dimensions.duration > 1); assert.ok(Math.abs(dimensions.width / dimensions.height - expectedAspect) < .04);
  pass('Recorded WebM dimensions match the selected area', dimensions);
  assert.deepEqual(evidence.errors, []); pass('No renderer errors');
} catch (error) {
  evidence.failure = error.stack; console.error(error); process.exitCode = 1;
  const page = app?.windows()[0]; if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app?.close().catch(() => {}); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence:', output);
}
