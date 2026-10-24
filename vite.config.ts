import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({ plugins: [react(), { name: 'production-csp', transformIndexHtml(html) { return command === 'build' ? html.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'").replace("connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*", "connect-src 'none'") : html; } }], root: 'apps/desktop', base: './', build: { outDir: '../../dist', emptyOutDir: true }, server: { port: 5173, strictPort: true } }));
