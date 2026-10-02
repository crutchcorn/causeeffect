import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'causeeffect-gtsx-host',
    environment: 'node',
    include: ['tests/host.spec.mjs'],
    watch: false,
    testTimeout: Number(process.env.HOST_TEST_TIMEOUT_MS ?? 90_000) + 60_000,
  },
});
