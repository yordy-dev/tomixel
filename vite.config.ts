import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { randomBytes } from 'node:crypto';
export default defineConfig(({ command }) => {
  const nonce = randomBytes(18).toString('base64');
  return {
    plugins: [react(), tailwindcss(), { name: 'development-csp-nonce', apply: 'serve', transformIndexHtml: html => html.replace("script-src 'self' 'wasm-unsafe-eval';", `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}';`) }],
    html: command === 'serve' ? { cspNonce: nonce } : undefined,
    base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true }
  };
});
