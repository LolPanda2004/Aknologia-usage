import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Admin console: served by the Go backend at /app/. In dev, API calls proxy to the backend on :8080.
export default defineConfig({
  root: 'admin',
  base: '/app/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: '../dist/admin', emptyOutDir: true },
});
