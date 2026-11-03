import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Desktop window: bundled into the Wails app (desktop/frontend/dist). Talks to the local agent on 127.0.0.1:47811.
export default defineConfig({
  root: 'desktop',
  base: './',
  plugins: [react()],
  server: { port: 5174 },
  build: { outDir: '../../desktop/frontend/dist', emptyOutDir: true },
});
