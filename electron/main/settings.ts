import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults, isLegacyTeleprompterText, TELEPROMPTER_SPEEDS, TELEPROMPTER_WELCOME, type Settings } from '../../shared/types';

const settingsSchemaVersion = 10;

const shortcutNames = ['record', 'pause', 'mic', 'zoom150', 'zoom200', 'cameraSmall', 'cameraMedium', 'cameraFullscreen', 'cameraImage'] as const;
const modifierNames = new Set(['CommandOrControl', 'Control', 'Ctrl', 'Alt', 'Shift', 'Super']);
const forbiddenShortcuts = new Set(['alt+f4', 'super+l', 'control+alt']);

/** Only one modifier plus one usable key: two physical keys, easy to remember. */
export function validTwoKeyShortcut(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80) return false;
  const parts = value.split('+');
  if (parts.length !== 2 || !modifierNames.has(parts[0]) || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Tab|Up|Down|Left|Right|Plus|Minus)$/i.test(parts[1])) return false;
  return !forbiddenShortcuts.has(value.toLowerCase());
}

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('Ajustes inválidos.');
  const s = input as Record<string, unknown>;
  const out = { ...defaults, shortcuts: { ...defaults.shortcuts } };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (key === 'shortcuts') continue;
    if (typeof s[key] !== typeof defaults[key]) throw new Error(`Ajuste inválido: ${key}`);
    (out as unknown as Record<string, unknown>)[key] = s[key];
  }
  const choices: Partial<Record<keyof Settings, unknown[]>> = {
    screenFps: [30, 60], cameraFps: [30, 60], cameraResolution: [720, 1080],
    quality: ['low', 'medium', 'high', 'very-high'],
    size: ['small', 'medium', 'large'], position: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    countdown: [0, 3, 5, 10], theme: ['system', 'light', 'dark'],
    cameraView: ['bubble', 'fullscreen', 'image'], captureResolution: ['1080p', '1440p', '2160p', 'native'],
    cameraBackground: ['none', 'blur-soft', 'blur-strong', 'image'],
    voiceProfile: ['natural', 'noisy', 'room', 'speakers']
  };
  for (const [k, values] of Object.entries(choices)) if (!values.includes(s[k])) throw new Error(`Valor inválido: ${k}`);
  if (!Number.isFinite(out.micGain) || out.micGain < 0 || out.micGain > 2) throw new Error('Ganancia inválida.');
  if (!Number.isFinite(out.systemGain) || out.systemGain < 0 || out.systemGain > 1) throw new Error('Volumen del sistema inválido.');
  if (!Number.isInteger(out.fullscreenScale) || out.fullscreenScale < 10 || out.fullscreenScale > 100 || out.fullscreenScale % 10) throw new Error('Escala de pantalla completa inválida.');
  for (const key of ['cameraBrightness', 'cameraContrast', 'cameraTemperature', 'cameraSaturation'] as const) {
    if (!Number.isInteger(out[key]) || out[key] < -50 || out[key] > 50) throw new Error(`Ajuste de cámara inválido: ${key}.`);
  }
  if (!Number.isInteger(out.onboardingVersion) || out.onboardingVersion < 0 || out.onboardingVersion > 20) throw new Error('Estado del tutorial inválido.');
  if (!TELEPROMPTER_SPEEDS.includes(out.teleprompterSpeed as (typeof TELEPROMPTER_SPEEDS)[number])) throw new Error('Velocidad del teleprompter inválida.');
  if (!Number.isInteger(out.teleprompterFontSize) || out.teleprompterFontSize < 18 || out.teleprompterFontSize > 72) throw new Error('Tamaño del teleprompter inválido.');
  if (!Number.isFinite(out.teleprompterOpacity) || out.teleprompterOpacity < .35 || out.teleprompterOpacity > 1) throw new Error('Opacidad del teleprompter inválida.');
  if (!Number.isInteger(out.teleprompterWidth) || out.teleprompterWidth < 360 || out.teleprompterWidth > 1200) throw new Error('Ancho del teleprompter inválido.');
  if (out.teleprompterText.length > 30000) throw new Error('El guion es demasiado largo.');
  if (out.micId.length > 512 || out.cameraId.length > 512) throw new Error('Dispositivo inválido.');
  if (out.cameraImage.length > 2000000 || (out.cameraImage && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(out.cameraImage))) throw new Error('Imagen de cámara inválida.');
  if (out.cameraBackgroundImage.length > 5000000 || (out.cameraBackgroundImage && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(out.cameraBackgroundImage))) throw new Error('Fondo de cámara inválido.');
  if (out.cameraView === 'image' && !out.cameraImage) throw new Error('Carga una imagen en Ajustes → Cámara antes de usarla.');
  if (out.cameraBackground === 'image' && !out.cameraBackgroundImage) throw new Error('Carga una imagen de fondo antes de activarla.');
  const keys = s.shortcuts as Record<string, unknown>;
  if (!keys || typeof keys !== 'object') throw new Error('Atajos inválidos.');
  for (const key of shortcutNames) {
    if (!validTwoKeyShortcut(keys[key])) throw new Error('Atajo inválido. Usa dos teclas, por ejemplo Ctrl+R.');
    out.shortcuts[key] = keys[key];
  }
  if (new Set(Object.values(out.shortcuts).map(s => s.toLowerCase())).size !== shortcutNames.length) throw new Error('Los atajos deben ser distintos.');
  return out;
}
export async function atomicJSON(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(`${file}.tmp`, file);
}
export class Preferences {
  settings = { ...defaults, shortcuts: { ...defaults.shortcuts } };
  firstRun = true;
  root = path.join(app.getPath('videos'), 'LocalRecorder');
  file = path.join(app.getPath('userData'), 'settings.json');
  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.firstRun = false;
      const legacyShortcuts = value.settings?.shortcuts || {};
      const migratedShortcuts = Object.fromEntries(shortcutNames.map(key => {
        const value = legacyShortcuts[key];
        // Previous versions used three keys by default. Preserve the action while
        // moving it to the new two-key model requested by the user.
        const migrated = typeof value === 'string' ? value.replace(/^(CommandOrControl|Control|Ctrl|Alt|Shift|Super)\+Shift\+/, '$1+') : value;
        return [key, validTwoKeyShortcut(migrated) ? migrated : defaults.shortcuts[key]];
      }));
      const loaded = { ...defaults, ...value.settings, shortcuts: { ...defaults.shortcuts, ...migratedShortcuts } };
      const migratedTeleprompter = isLegacyTeleprompterText(loaded.teleprompterText);
      if (migratedTeleprompter) loaded.teleprompterText = TELEPROMPTER_WELCOME;
      if (!TELEPROMPTER_SPEEDS.includes(loaded.teleprompterSpeed as (typeof TELEPROMPTER_SPEEDS)[number])) {
        loaded.teleprompterSpeed = TELEPROMPTER_SPEEDS.reduce((closest, speed) => Math.abs(speed - Number(loaded.teleprompterSpeed)) < Math.abs(closest - Number(loaded.teleprompterSpeed)) ? speed : closest, TELEPROMPTER_SPEEDS[0]);
      }
      if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 3) {
        loaded.noiseSuppression = false;
        loaded.neuralNoiseSuppression = true;
        loaded.autoGainControl = false;
        loaded.micGain = Math.min(Number.isFinite(loaded.micGain) ? loaded.micGain : defaults.micGain, defaults.micGain);
        loaded.systemGain = defaults.systemGain;
      }
      this.settings = validateSettings(loaded);
      if (typeof value.root === 'string' && path.isAbsolute(value.root)) this.root = value.root;
      if (migratedTeleprompter) await this.persist();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') await this.persist();
      else await fs.copyFile(this.file, `${this.file}.backup`).catch(() => {});
    }
  }
  async persist() { await atomicJSON(this.file, { schemaVersion: settingsSchemaVersion, settings: this.settings, root: this.root }); }
}
