/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swManifest } from './scripts/sw-manifest.mjs';

// `base: './'` makes the build work from any sub-path (e.g. GitHub Pages /repo/).
export default defineConfig({
  base: './',
  plugins: [react(), swManifest()],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
