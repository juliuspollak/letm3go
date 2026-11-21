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

it('reads the session from native once for a burst of reads, and again after a write or a removal',async()=>{
 authStorage.clearReadCache();m.get.mockReset();m.set.mockReset();m.remove=vi.fn(async()=>({}));
 m.get.mockResolvedValue({value:'session-1'});
 const burst=await Promise.all([authStorage.getItem('k'),authStorage.getItem('k'),authStorage.getItem('k')]);
 expect(burst).toEqual(['session-1','session-1','session-1']);
 expect(await authStorage.getItem('k')).toBe('session-1');
 expect(m.get).toHaveBeenCalledTimes(1);
 m.set.mockResolvedValue({});m.get.mockResolvedValue({value:'session-2'});
 await authStorage.setItem('k','session-2');
 expect(await authStorage.getItem('k')).toBe('session-2');
 expect(m.get).toHaveBeenCalledTimes(2);
 m.get.mockResolvedValue({value:null});
 await authStorage.removeItem('k');
 expect(await authStorage.getItem('k')).toBeNull();
 expect(m.get).toHaveBeenCalledTimes(3);
});
it('does not let a read that was already in flight put a stale session back after a write',async()=>{
 authStorage.clearReadCache();m.get.mockReset();m.set.mockReset();
 let release;m.get.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({value:'old'});}));
 const slow=authStorage.getItem('race');
 m.set.mockResolvedValue({});await authStorage.setItem('race','new');
 release();expect(await slow).toBe('old');
 m.get.mockResolvedValue({value:'new'});
 expect(await authStorage.getItem('race')).toBe('new');
});
it('forgets a cached answer after a few seconds',async()=>{
 authStorage.clearReadCache();m.get.mockReset();
 vi.useFakeTimers();
 try{
  m.get.mockResolvedValue({value:'a'});
  expect(await authStorage.getItem('ttl')).toBe('a');
  vi.advanceTimersByTime(3500);
  m.get.mockResolvedValue({value:'b'});
  expect(await authStorage.getItem('ttl')).toBe('b');
 }finally{vi.useRealTimers();}
});

it('drops a read that was already in flight when the cache is cleared (a native account change)',async()=>{
 authStorage.clearReadCache();m.get.mockReset();
 let release;m.get.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({value:'previous-account'});}));
 const slow=authStorage.getItem('account');
 authStorage.clearReadCache();
 release();expect(await slow).toBe('previous-account');   // the caller that asked gets what it asked for...
 m.get.mockResolvedValue({value:'new-account'});
 expect(await authStorage.getItem('account')).toBe('new-account');   // ...but nobody after the clear is answered from it
});
