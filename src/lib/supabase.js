import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { config } from './config.js';
import { authStorage, AUTH_STORAGE_KEY } from './sessionStorage.js';

// No placeholder host, credentials, or network calls when configuration is absent.
export const supabase = config.configured ? createClient(config.url, config.key, {
  auth: {
    flowType: 'pkce', persistSession: true, autoRefreshToken: true,
    detectSessionInUrl: !Capacitor.isNativePlatform(),
    storage:authStorage, storageKey:AUTH_STORAGE_KEY,
  },
}) : null;
