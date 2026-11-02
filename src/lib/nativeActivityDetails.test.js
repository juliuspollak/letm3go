import {describe,expect,it,vi} from 'vitest';
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'web'},registerPlugin:()=>({})}));
import {NATIVE_DETAILS_OPT_IN,nativeDetailsMode,resolveNativeDetails,setNativeDetailsOptIn} from './nativeActivityDetails.js';

const store=value=>({getItem:()=>value,setItem:vi.fn(),removeItem:vi.fn()});
describe('native Activity Details flag',()=>{
 it('is off unless a build says otherwise',()=>{
  expect(nativeDetailsMode({})).toBe('off');
  expect(nativeDetailsMode({VITE_NATIVE_ACTIVITY_DETAILS:'yes'})).toBe('off');
  expect(resolveNativeDetails({platform:'ios',mode:'off',storage:store('1')})).toBe(false);
 });
 it('never applies outside iOS',()=>expect(resolveNativeDetails({platform:'web',mode:'on',storage:store('1')})).toBe(false));
 it('needs an explicit opt-in while testing',()=>{
  expect(resolveNativeDetails({platform:'ios',mode:'testing',storage:store(null)})).toBe(false);
  expect(resolveNativeDetails({platform:'ios',mode:'testing',storage:store('1')})).toBe(true);
 });
 it('treats unreadable storage as off',()=>{
  expect(resolveNativeDetails({platform:'ios',mode:'testing',storage:{getItem(){throw new Error('denied');}}})).toBe(false);
 });
 it('stores the opt-in under one key',()=>{
  const storage=store(null);
  setNativeDetailsOptIn(true,storage);
  expect(storage.setItem).toHaveBeenCalledWith(NATIVE_DETAILS_OPT_IN,'1');
  setNativeDetailsOptIn(false,storage);
  expect(storage.removeItem).toHaveBeenCalledWith(NATIVE_DETAILS_OPT_IN);
 });
});
