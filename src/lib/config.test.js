import { it, expect } from 'vitest';
import { readConfig } from './config.js';

it('starts offline with integrations disabled', () => {
  expect(readConfig()).toMatchObject({ configured: false, appleEnabled: false, pushEnabled: false, apnsEnvironment: 'sandbox' });
});
it('requires both public configuration values and a valid URL', () => {
  expect(readConfig({ VITE_SUPABASE_URL: 'invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test' }).configured).toBe(false);
  expect(readConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co' }).configured).toBe(false);
  expect(readConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test' }).configured).toBe(true);
});
