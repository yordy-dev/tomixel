import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(`test-results/dev-${Date.now()}`); await fs.mkdir(profile, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.LOCAL_RECORDER_PACKAGED_TEST;
const child = spawn(process.execPath, ['scripts/dev.mjs', '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logs = ''; child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
let browser;
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  assert.ok(port, logs);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('#bubble')); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.reload(); await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor({ timeout: 30000 });
  assert.deepEqual(errors, []); assert.ok(page.url().startsWith('http://127.0.0.1:5173'));
  await page.screenshot({ path: path.join(profile, 'development.png') });
  console.log('PASS development runner, React refresh preamble, secure IPC, CSP and real devices');
  await page.evaluate(() => window.desktop.exitReady());
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('El proceso de desarrollo no terminó después de solicitar la salida.')), 10000))
  ]);
} catch (e) { console.error(e, logs); process.exitCode = 1; child.kill(); }
finally { await browser?.close().catch(() => {}); await fs.writeFile(path.join(profile, 'process.log'), logs); }
