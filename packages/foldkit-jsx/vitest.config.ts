import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'foldkit-jsx',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
