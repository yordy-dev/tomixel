import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import electronPath from 'electron';

const root = path.resolve('.');
const imageDir = path.join(root, 'docs', 'images');
const mediaDir = path.join(root, 'docs', 'media');
const scratch = path.join(root, 'test-results', `readme-media-${Date.now()}`);
const profile = path.join(scratch, 'profile');
const mp4Video = path.join(mediaDir, 'tomixel-demo.mp4');
const gifVideo = path.join(mediaDir, 'tomixel-demo.gif');

await Promise.all([imageDir, mediaDir, scratch].map(folder => fs.mkdir(folder, { recursive: true })));

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { windowsHide: true });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code ? reject(new Error(output)) : resolve(output));
  });
}

const demoHTML = `<!doctype html><html><head><meta charset="utf-8"><title>Escenario de demostración</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(135deg,#f7f8fb 0%,#eef3f5 55%,#fff4f0 100%);font-family:Segoe UI,Arial,sans-serif;color:#222833;overflow:hidden}.bar{height:58px;background:rgba(255,255,255,.9);display:flex;align-items:center;padding:0 34px;border-bottom:1px solid #dfe4e8;gap:13px}.mark{width:26px;height:26px;border:4px solid #ff624d;border-radius:9px;position:relative}.mark:after{content:'';position:absolute;width:7px;height:7px;border-radius:50%;background:#ff624d;left:50%;top:50%;transform:translate(-50%,-50%)}.bar strong{font-size:17px}.bar span{margin-left:auto;color:#697381}.hero{padding:62px 76px 36px;display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:44px}.eyebrow{font-size:13px;letter-spacing:.16em;color:#ff624d;font-weight:800}.hero h1{font-size:53px;line-height:1.04;margin:12px 0 18px;max-width:620px}.hero p{font-size:20px;line-height:1.55;color:#596271;max-width:610px}.visual{height:315px;border-radius:30px;background:#222833;box-shadow:0 24px 70px rgba(26,33,42,.18);padding:25px;position:relative;overflow:hidden}.screen{height:100%;border-radius:18px;background:linear-gradient(140deg,#303947,#171c24);padding:28px}.line{height:12px;background:#667282;border-radius:20px;margin-bottom:15px;animation:pulse 2.4s ease-in-out infinite}.line:nth-child(2){width:78%}.line:nth-child(3){width:56%}.record{position:absolute;right:28px;bottom:25px;background:#ff624d;color:white;padding:13px 19px;border-radius:14px;font-weight:700;animation:float 2.2s ease-in-out infinite}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:0 76px}.card{background:rgba(255,255,255,.88);border:1px solid #e3e7ea;border-radius:20px;padding:20px 22px}.card b{display:block;margin-bottom:7px}.card span{color:#697381}@keyframes pulse{50%{opacity:.45;transform:translateX(9px)}}@keyframes float{50%{transform:translateY(-7px)}}
</style></head><body><div class="bar"><i class="mark"></i><strong>Escenario de demostración</strong><span>Contenido de ejemplo</span></div><main class="hero"><section><div class="eyebrow">UNA IDEA, AHORA EN VIDEO</div><h1>Explica tu pantalla con claridad.</h1><p>Un espacio neutro creado para demostrar grabación, zoom, cámara y edición sin mostrar datos personales.</p></section><section class="visual"><div class="screen"><div class="line"></div><div class="line"></div><div class="line"></div></div><div class="record">Grabando demostración</div></section></main><section class="cards"><div class="card"><b>Captura local</b><span>Tus archivos permanecen en tu equipo.</span></div><div class="card"><b>Presentación</b><span>Cámara, zoom y teleprompter.</span></div><div class="card"><b>Edición</b><span>Corta y exporta sin salir de Tomixel.</span></div></section></body></html>`;

let app;
let targetProcess;
try {
  const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: profile, LOCAL_RECORDER_PACKAGED_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: ['.'],
    env,
    chromiumSandbox: true
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  const skip = page.getByRole('button', { name: 'Omitir tutorial', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();

  const initial = await page.evaluate(() => window.desktop.config());
  await page.evaluate(async settings => {
    await window.desktop.setSettings(settings);
  }, {
    ...initial.settings,
    onboardingVersion: 5,
    theme: 'light',
    countdown: 0,
    cameraEnabled: false,
    micEnabled: false,
    systemAudio: false,
    cameraBackground: 'none',
    teleprompterText: 'Presenta tus ideas con naturalidad.\n\nTomixel mantiene el guion cerca de la cámara mientras grabas.\n\nUsa el zoom para destacar lo importante y termina tu video en el editor integrado.',
    teleprompterSpeed: 110,
    teleprompterFontSize: 34,
    teleprompterOpacity: .92,
    teleprompterWidth: 620
  });
  await page.reload();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  await page.waitForTimeout(900);
  const deviceLabels = page.locator('.device-label');
  if (await deviceLabels.count() >= 2) {
    await deviceLabels.nth(0).evaluate((element, label) => { const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE); if (text) text.textContent = label; }, 'Cámara opcional');
    await deviceLabels.nth(1).evaluate((element, label) => { const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE); if (text) text.textContent = label; }, 'Micrófono opcional');
  }
  await page.screenshot({ path: path.join(imageDir, '01-inicio.png') });

  const demoFile = path.join(scratch, 'demo.html');
  const demoMain = path.join(scratch, 'demo-main.cjs');
  const demoReady = path.join(scratch, 'demo-ready');
  await fs.writeFile(demoFile, demoHTML, 'utf8');
  await fs.writeFile(demoMain, `const { app, BrowserWindow } = require('electron');\nconst fs = require('node:fs');\napp.setName('Escenario de demostración');\nlet win;\napp.whenReady().then(async () => {\n  win = new BrowserWindow({ width: 1280, height: 720, x: 36, y: 36, show: false, title: 'Escenario de demostración', backgroundColor: '#f7f8fb' });\n  await win.loadFile(${JSON.stringify(demoFile)});\n  win.setTitle('Escenario de demostración');\n  win.show();\n  fs.writeFileSync(${JSON.stringify(demoReady)}, 'ready');\n});\napp.on('window-all-closed', () => app.quit());\n`, 'utf8');
  targetProcess = spawn(electronPath, [demoMain], { windowsHide: false, stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await fs.access(demoReady).then(() => true).catch(() => false)) break;
    await page.waitForTimeout(100);
  }
  if (!await fs.access(demoReady).then(() => true).catch(() => false)) throw new Error('No se abrió el escenario seguro de demostración.');
  await page.waitForTimeout(700);

  const targetSource = await page.evaluate(async () => (await window.desktop.sources()).find(source => source.name.includes('Escenario de demostración')));
  if (!targetSource) throw new Error('Electron no devolvió la ventana segura de demostración como fuente de captura.');

  await page.getByRole('button', { name: /Qué quieres grabar/ }).click();
  await page.getByRole('heading', { name: 'Elige tu escenario', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ventanas', exact: true }).click();
  const targetTile = page.locator('.source-tile').filter({ hasText: targetSource.name });
  await targetTile.waitFor();
  await page.locator('.source-tile').evaluateAll((tiles, wanted) => {
    for (const tile of tiles) if (!tile.textContent?.includes(wanted)) tile.setAttribute('hidden', '');
  }, targetSource.name);
  await page.screenshot({ path: path.join(imageDir, '02-fuentes.png') });
  await targetTile.click();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();

  await page.evaluate(() => window.desktop.showTeleprompter());
  let teleprompter;
  for (let attempt = 0; attempt < 80 && !teleprompter; attempt++) {
    teleprompter = app.windows().find(candidate => candidate.url().includes('#teleprompter'));
    if (!teleprompter) await page.waitForTimeout(100);
  }
  if (!teleprompter) throw new Error('No se abrió el teleprompter para la captura.');
  await teleprompter.locator('.teleprompter-content').waitFor();
  await teleprompter.waitForFunction(() => document.querySelector('.teleprompter-content')?.textContent?.includes('Presenta tus ideas con naturalidad.'));
  await teleprompter.screenshot({ path: path.join(imageDir, '04-teleprompter.png') });
  await page.evaluate(() => window.desktop.hideTeleprompter());

  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(imageDir, '03-grabacion.png') });
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  await page.getByRole('heading', { name: 'Así quedó tu grabación', exact: true }).waitFor();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(imageDir, '05-editor.png') });

  const icon = await fs.readFile(path.join(root, 'public', 'icon.png'));
  const iconData = `data:image/png;base64,${icon.toString('base64')}`;
  await app.evaluate(async ({ BrowserWindow }, input) => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tomixel Social Preview</title><style>*{box-sizing:border-box}body{margin:0;width:1280px;height:640px;background:linear-gradient(135deg,#171c24,#28303c 60%,#4d2925);font-family:Segoe UI,Arial,sans-serif;color:white;display:flex;align-items:center;padding:86px 105px;overflow:hidden}.glow{position:absolute;width:530px;height:530px;border-radius:50%;right:-80px;top:-110px;background:radial-gradient(circle,#ff624d 0%,rgba(255,98,77,.2) 45%,transparent 70%)}img{width:150px;height:150px;border-radius:36px;box-shadow:0 22px 60px rgba(0,0,0,.3)}main{margin-left:56px;position:relative;z-index:1}small{letter-spacing:.18em;color:#ff8a78;font-weight:800;font-size:18px}h1{font-size:94px;line-height:1;margin:13px 0 20px}p{font-size:30px;color:#d9dee5;margin:0;max-width:760px;line-height:1.35}</style></head><body><div class="glow"></div><img src="${input.icon}"><main><small>GRABADORA LOCAL PARA WINDOWS</small><h1>Tomixel</h1><p>Graba, presenta y edita tu pantalla sin salir de tu equipo.</p></main></body></html>`;
    const win = new BrowserWindow({ width: 1280, height: 640, show: true, frame: false, backgroundColor: '#171c24' });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    globalThis.__tomixelSocialPreview = win;
  }, { icon: iconData });
  let social;
  for (let attempt = 0; attempt < 50 && !social; attempt++) {
    social = app.windows().find(candidate => candidate.url().startsWith('data:text/html') && candidate.url().includes('Tomixel%20Social%20Preview'));
    if (!social) await page.waitForTimeout(100);
  }
  if (social) await social.screenshot({ path: path.join(imageDir, 'social-preview.png') });
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  targetProcess?.kill();
}

const slides = ['01-inicio.png', '02-fuentes.png', '03-grabacion.png', '04-teleprompter.png', '05-editor.png'].map(name => path.join(imageDir, name));
const slideInputs = slides.flatMap(file => ['-loop', '1', '-t', '2.5', '-i', file]);
const normalize = slides.map((_, index) => `[${index}:v]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=0x171c24,setsar=1,format=yuv420p[v${index}]`).join(';');
const transitions = '[v0][v1]xfade=transition=fade:duration=0.45:offset=2.05[x1];[x1][v2]xfade=transition=fade:duration=0.45:offset=4.10[x2];[x2][v3]xfade=transition=fade:duration=0.45:offset=6.15[x3];[x3][v4]xfade=transition=fade:duration=0.45:offset=8.20[vout]';
await ffmpeg([...slideInputs, '-filter_complex', `${normalize};${transitions}`, '-map', '[vout]', '-t', '10.7', '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Video]);
await ffmpeg(['-i', mp4Video, '-vf', 'fps=10,scale=800:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', gifVideo]);

const files = await Promise.all([
  '01-inicio.png', '02-fuentes.png', '03-grabacion.png', '04-teleprompter.png', '05-editor.png', 'social-preview.png'
].map(async name => ({ name, size: (await fs.stat(path.join(imageDir, name))).size })));
files.push({ name: 'tomixel-demo.gif', size: (await fs.stat(gifVideo)).size });
files.push({ name: 'tomixel-demo.mp4', size: (await fs.stat(mp4Video)).size });
console.log(JSON.stringify({ imageDir, mediaDir, files }, null, 2));
