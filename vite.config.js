import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  if (['supabase','testflight'].includes(mode)) throw new Error('Credential modes are reserved and cannot be used by Vite.');
  return {
    envPrefix: 'VITE_',
    plugins: [react()],
    test: { maxWorkers: 4, environment: 'jsdom', setupFiles: ['./src/test/setup.js'], clearMocks: true },
  };
});