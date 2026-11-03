import {describe,expect,it,vi} from 'vitest';
import {defaultPrecision,precisionOffered,savePrecision,savedPrecision} from './gpsPrecision.js';

const memory=()=>{const values={};return {getItem:key=>values[key]??null,setItem:(key,value)=>{values[key]=value;}};};
describe('GPS precision',()=>{
 it('defaults mountain biking to high and the rest to balanced',()=>{
  expect(defaultPrecision('MTB')).toBe('high');
  expect(defaultPrecision('Walking')).toBe('balanced');
 });
 it('remembers a choice per activity',()=>{
  const storage=memory();
  savePrecision('MTB','saver',storage);
  expect(savedPrecision('MTB',storage)).toBe('saver');
  expect(savedPrecision('Walking',storage)).toBe('balanced');
 });
 it('ignores anything it does not know',()=>{
  expect(savedPrecision('MTB',{getItem:()=>'ultra'})).toBe('high');
  expect(savedPrecision('MTB',{getItem:vi.fn(()=>{throw new Error('denied');})})).toBe('high');
 });
 it('is not offered for a drive',()=>expect(precisionOffered('Driving')).toBe(false));
});
