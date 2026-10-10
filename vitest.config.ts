import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['**/*.live.test.ts'],
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: 'ui',
          include: ['apps/desktop/src/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: 'live',
          include: ['packages/*/test/**/*.live.test.ts'],
          testTimeout: 600000,
        },
      },
    ],
  },
});
