import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxy = {
  target: process.env.YKSPRITE_API_TARGET ?? 'http://127.0.0.1:3000',
  rewrite: (requestPath: string) => requestPath.replace(/^\/api/, '')
};

export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    proxy: {
      '/api/accounts': backendProxy,
      '/api/tasks': backendProxy,
      '/api/events': backendProxy,
      '/api/answers': backendProxy,
      '/api/api-config': backendProxy
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
