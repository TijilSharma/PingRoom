import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Both development proxies follow the same API port as npm start.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = `http://127.0.0.1:${env.PORT || 3100}`;
  return {
    root: 'client',
    plugins: [react()],
    build: { outDir: '../dist', emptyOutDir: true },
    server: {
      host: '127.0.0.1',
      proxy: { '/api': target, '/socket.io': { target, ws: true } },
    },
  };
});
