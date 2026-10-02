import { gtsx } from '@causeeffect/jsx-content-mapper/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    gtsx({
      jsxRuntime: 'classic',
      jsxFactory: 'jsx.createElement',
      jsxFragmentFactory: 'jsx.Fragment',
    }),
  ],
  test: {
    name: '@causeeffect/foldkit-example',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
