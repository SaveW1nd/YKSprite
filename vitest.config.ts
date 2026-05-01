import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@yksprite/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./apps/web/src/test/setup.ts'],
    exclude: [...configDefaults.exclude, 'backup/**']
  }
});
