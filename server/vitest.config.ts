import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    globalSetup: './tests/global-setup.ts',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
