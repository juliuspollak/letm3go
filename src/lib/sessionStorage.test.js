import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false},registerPlugin:()=>({})}));
import { accountStore, authStorage, AUTH_STORAGE_KEY } from './sessionStorage.js';
afterEach(async()=>{await accountStore.lock();localStorage.clear();});
it('isolates profile, vehicle and onboarding caches between accounts',async()=>{
 await accountStore.bind({user:{id:'A'}});await accountStore.save({displayName:'A',vehicles:[{name:'A car'}],onboardingComplete:true},'A');
 const b=await accountStore.bind({user:{id:'B'}});expect(b.preferences.displayName).toBe('');expect(b.preferences.vehicles).toEqual([]);expect(b.preferences.onboardingComplete).toBe(false);
 await expect(accountStore.save({displayName:'wrong'},'A')).rejects.toThrow();
 const a=await accountStore.bind({user:{id:'A'}});expect(a.preferences.displayName).toBe('A');expect(a.preferences.vehicles[0].name).toBe('A car');
});
it('does not unlock a different account offline or bypass explicit logout',async()=>{
 await accountStore.bind({user:{id:'A'}});
 await expect(accountStore.bind({user:{id:'B'}},'',{offline:true})).rejects.toThrow();
 await accountStore.lock();await expect(accountStore.bind({user:{id:'A'}},'',{offline:true})).rejects.toThrow();
});

it('does not restore a late SDK cache write after an explicit logout',async()=>{
 await accountStore.bind({user:{id:'A'}});await accountStore.lock();localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify({user:{id:'A'}}));
 expect(await authStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();await accountStore.beginSignIn();expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
});

it('deletes only the current account durable journey records on local account deletion',async()=>{
 await import('fake-indexeddb/auto');
 const {journeyDurableStorage}=await import('./journeyDurableStorage.js');
 await accountStore.bind({user:{id:'delete-A'}});
 await journeyDurableStorage('delete-A').commit([{key:'private',value:'A'}]);
 await journeyDurableStorage('delete-B').commit([{key:'private',value:'B'}]);
 await accountStore.deleteLocal();
 expect(await journeyDurableStorage('delete-A').read()).toEqual({});
 expect(await journeyDurableStorage('delete-B').read()).toEqual({private:'B'});
});
