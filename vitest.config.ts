import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./apps/web/src/test/setup.ts'],
    exclude: [...configDefaults.exclude, 'backup/**']
  }
});
