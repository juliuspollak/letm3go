import {describe,expect,it,vi} from 'vitest';
import {renderHook,waitFor} from '@testing-library/react';
import {driveTimeText,useDriveTimes} from './useDriveTimes.js';

vi.mock('./recorder.js',()=>({recorder:{roadRoute:vi.fn()},recorderAvailable:()=>true}));

describe('drive times',()=>{
 it('words minutes and hours',()=>{
  expect(driveTimeText(20)).toBe('1 min drive');
  expect(driveTimeText(14*60+10)).toBe('14 min drive');
  expect(driveTimeText(3600)).toBe('1 h drive');
  expect(driveTimeText(5400)).toBe('1 h 30 min drive');
  expect(driveTimeText(NaN)).toBe('');
 });
 it('asks Apple Maps once per person and keeps the quickest route',async()=>{
  const lookup=vi.fn().mockResolvedValue({routes:[{expectedSeconds:900},{expectedSeconds:600}]});
  const people=[{userId:'a',state:'live',position:{latitude:-33.8,longitude:151.2}},{userId:'b',state:'off',position:null}];
  const {result,rerender}=renderHook(props=>useDriveTimes(props),{initialProps:{people,from:{latitude:-33.9,longitude:151.1},enabled:true,lookup}});
  await waitFor(()=>expect(result.current).toEqual({a:600}));
  rerender({people:[...people],from:{latitude:-33.9,longitude:151.1},enabled:true,lookup});
  expect(lookup).toHaveBeenCalledTimes(1);
 });
 it('does nothing off the map',()=>{
  const lookup=vi.fn();
  renderHook(()=>useDriveTimes({people:[{userId:'a',state:'live',position:{latitude:1,longitude:1}}],from:{latitude:2,longitude:2},enabled:false,lookup}));
  expect(lookup).not.toHaveBeenCalled();
 });
});
