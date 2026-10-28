import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(`test-results/onboarding-${Date.now()}`);
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_TEST_ONBOARDING: '1', LOCAL_RECORDER_PACKAGED_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const executablePath = process.env.LOCAL_RECORDER_EXECUTABLE;
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('dialog', { name: 'Aprende lo esencial en cinco pasos' }).waitFor();
  const config = await page.evaluate(() => window.desktop.config());
  assert.equal(config.firstRun, true);
  assert.equal(config.settings.onboardingVersion, 0);
  await page.getByRole('button', { name: 'Entrar sin tutorial', exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  const complete = await page.evaluate(() => window.desktop.config());
  assert.equal(complete.settings.onboardingVersion, 5);
  console.log('PASS fresh profile shows the initial tutorial and persists completion');

  await app.close(); app = undefined;
  const settingsFile = path.join(output, 'profile', 'settings.json');
  const previous = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  previous.settings.onboardingVersion = 4;
  await fs.writeFile(settingsFile, JSON.stringify(previous, null, 2));
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
  const updatePage = await app.firstWindow(); updatePage.setDefaultTimeout(20000);
  await updatePage.getByRole('dialog', { name: 'Aprende lo esencial en cinco pasos' }).waitFor();
  assert.equal((await updatePage.evaluate(() => window.desktop.config())).firstRun, false);
  await updatePage.getByRole('button', { name: 'Entrar sin tutorial', exact: true }).click();
  await updatePage.getByRole('button', { name: 'Iniciar grabación', exact: true }).waitFor();
  assert.equal((await updatePage.evaluate(() => window.desktop.config())).settings.onboardingVersion, 5);
  console.log('PASS this update shows the tutorial once to an existing version 4 profile');
} finally {
  if (app) await app.close();
  await fs.mkdir(output, { recursive: true });
}
