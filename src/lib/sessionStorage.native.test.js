import { afterEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({get:vi.fn(),set:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true},registerPlugin:()=>m}));
import { authStorage, AUTH_STORAGE_KEY } from './sessionStorage.js';
afterEach(()=>localStorage.clear());
it('does not migrate a stale WebView session over an explicit native logout',async()=>{localStorage.setItem(AUTH_STORAGE_KEY,'stale-session');m.get.mockResolvedValue({value:null,signedOut:true});expect(await authStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();expect(m.set).not.toHaveBeenCalled();expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();});
