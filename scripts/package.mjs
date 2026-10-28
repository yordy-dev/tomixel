import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const env = { ...process.env };
// GUI-launched shells can omit Windows PowerShell from PATH. electron-builder's
// dependency collector requires it. Fix only this child's environment.
if (process.platform === 'win32') {
  const keys = Object.keys(env).filter(key => key.toLowerCase() === 'path');
  const previous = keys.map(key => env[key]).join(path.delimiter);
  keys.forEach(key => delete env[key]);
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const dirs = [path.join(systemRoot, 'System32'), path.join(systemRoot, 'System32/WindowsPowerShell/v1.0')].filter(fs.existsSync);
  env.Path = [...dirs, previous].join(path.delimiter);
}
const mode = process.argv[2] === 'dir' ? ['--dir'] : ['nsis'];
const child = spawn(process.execPath, ['node_modules/electron-builder/out/cli/cli.js', '--win', ...mode, '--x64'], { stdio: 'inherit', env, windowsHide: true });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error); process.exit(1); });
