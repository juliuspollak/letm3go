import { afterEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({get:vi.fn(),set:vi.fn(),savePreferences:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true},registerPlugin:()=>m}));
import { authStorage, accountStore, AUTH_STORAGE_KEY } from './sessionStorage.js';
afterEach(()=>localStorage.clear());
it('does not migrate a stale WebView session over an explicit native logout',async()=>{localStorage.setItem(AUTH_STORAGE_KEY,'stale-session');m.get.mockResolvedValue({value:null,signedOut:true});expect(await authStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();expect(m.set).not.toHaveBeenCalled();expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();});
it('normalises nested non-finite receipt values before the native bridge without changing the caller',async()=>{
 const preferences={displayName:'J',onboardingStep:2,syncReceipts:{activity:{owner:'A',updatedAt:NaN,revision:Infinity},other:{updatedAt:123,missing:undefined}}};
 m.savePreferences.mockResolvedValue({ownerID:'A'});
 await accountStore.save(preferences,'A');
 expect(m.savePreferences).toHaveBeenLastCalledWith({ownerID:'A',preferences:{displayName:'J',onboardingStep:2,syncReceipts:{activity:{owner:'A',updatedAt:null,revision:null},other:{updatedAt:123}}}});
 expect(Number.isNaN(preferences.syncReceipts.activity.updatedAt)).toBe(true);
});
it('rejects unrepresentable settings before invoking native persistence',async()=>{
 const preferences={};preferences.cycle=preferences;
 m.savePreferences.mockClear();
 await expect(accountStore.save(preferences,'A')).rejects.toThrow();
 expect(m.savePreferences).not.toHaveBeenCalled();
});
