import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(
        new URL('./src/testing/vscode.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'causeeffect-gtsx',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    watch: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
