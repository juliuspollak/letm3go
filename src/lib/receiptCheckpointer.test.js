import {describe,expect,it,vi} from 'vitest';
import {createReceiptCheckpointer} from './receiptCheckpointer.js';

const receipt=(revision,confirmedAt)=>({owner:'o',fingerprint:'f'.repeat(64),revision,confirmedAt,backupVersion:undefined});
function setup(overrides={}){
 const saved=[];let preferences={syncReceipts:{}};
 const savePreferences=vi.fn(async updater=>{const patch=updater(preferences);preferences={...preferences,...patch};saved.push(patch);return preferences;});
 const timers=[];
 const checkpointer=createReceiptCheckpointer({savePreferences,setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:id=>{timers[id-1]=null;},...overrides});
 return {checkpointer,saved,savePreferences,get preferences(){return preferences;},fire:()=>{const fn=timers.find(Boolean);if(fn){timers[timers.indexOf(fn)]=null;fn();}}};
}
describe('receipt checkpointing',()=>{
 it('writes many receipts as one save',async()=>{
  const t=setup();
  for(let i=1;i<=12;i++)t.checkpointer.record({[`activity:${i}`]:receipt(i,i)});
  expect(t.savePreferences).not.toHaveBeenCalled();
  await t.checkpointer.flush();
  expect(t.savePreferences).toHaveBeenCalledTimes(1);
  expect(Object.keys(t.preferences.syncReceipts)).toHaveLength(12);
 });
 it('saves by itself after the delay, and only once for a burst',async()=>{
  const t=setup();
  t.checkpointer.record({'activity:a':receipt(1,1)});t.checkpointer.record({'activity:b':receipt(1,2)});
  t.fire();await t.checkpointer.flush();
  expect(t.savePreferences).toHaveBeenCalledTimes(1);
 });
 it('does nothing when nothing was recorded',async()=>{
  const t=setup();await t.checkpointer.flush();
  expect(t.savePreferences).not.toHaveBeenCalled();
 });
 it('keeps the newer receipt when the same activity is recorded twice',async()=>{
  const t=setup();
  t.checkpointer.record({'activity:a':receipt(1,10)});t.checkpointer.record({'activity:a':receipt(2,20)});
  await t.checkpointer.flush();
  expect(Object.values(t.preferences.syncReceipts)[0].revision).toBe(2);
 });
 it('carries extra fields such as lastBackup in the same write',async()=>{
  const t=setup();
  t.checkpointer.record({'activity:a':receipt(1,1)},{lastBackup:'2026-11-22T00:00:00Z'});
  await t.checkpointer.flush();
  expect(t.saved).toHaveLength(1);expect(t.saved[0].lastBackup).toBe('2026-11-22T00:00:00Z');
 });
 it('reports a saved batch so the household share can follow it',async()=>{
  const onSaved=vi.fn();const t=setup({onSaved});
  t.checkpointer.record({'activity:a':receipt(1,1)});await t.checkpointer.flush();
  expect(onSaved).toHaveBeenCalledTimes(1);
 });
 it('never drops receipts when a save fails: they go out with the next write',async()=>{
  let fail=true;const saved=[];let preferences={syncReceipts:{}};
  const savePreferences=vi.fn(async updater=>{if(fail){fail=false;throw new Error('disk');}const patch=updater(preferences);preferences={...preferences,...patch};saved.push(patch);});
  const checkpointer=createReceiptCheckpointer({savePreferences,setTimer:()=>1,clearTimer:()=>{}});
  checkpointer.record({'activity:a':receipt(1,1)});
  await expect(checkpointer.flush()).rejects.toThrow('disk');
  expect(checkpointer.hasPending()).toBe(true);
  checkpointer.record({'activity:b':receipt(1,2)});
  await checkpointer.flush();
  expect(Object.keys(preferences.syncReceipts)).toHaveLength(2);
 });
 it('serialises writes: a flush started during a save waits for it',async()=>{
  const order=[];let release;const gate=new Promise(r=>{release=r;});
  const savePreferences=vi.fn(async()=>{order.push('start');await gate;order.push('end');});
  const checkpointer=createReceiptCheckpointer({savePreferences,setTimer:()=>1,clearTimer:()=>{}});
  checkpointer.record({'activity:a':receipt(1,1)});const first=checkpointer.flush();
  checkpointer.record({'activity:b':receipt(1,2)});const second=checkpointer.flush();
  await Promise.resolve();release();await Promise.all([first,second]);
  expect(order).toEqual(['start','end','start','end']);
 });
});
