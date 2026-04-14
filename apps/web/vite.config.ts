import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/health': 'http://127.0.0.1:3000',
      '/browser': 'http://127.0.0.1:3000',
      '/runtime': 'http://127.0.0.1:3000',
      '/tasks': 'http://127.0.0.1:3000',
      '/events': 'http://127.0.0.1:3000',
      '/assist': 'http://127.0.0.1:3000'
    }
  }
});
