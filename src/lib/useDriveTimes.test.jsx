import {describe,expect,it,vi} from 'vitest';
import {act,renderHook,waitFor} from '@testing-library/react';
import {recorder} from './recorder.js';
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

it('keeps the walking estimate while a moving person’s new route is calculated',async()=>{
 let finish;
 recorder.roadRoute.mockResolvedValueOnce({routes:[{expectedSeconds:900}]}).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const origin={latitude:-33.9,longitude:151.1};
 const person={userId:'a',state:'stale',position:{latitude:-33.8,longitude:151.2}};
 const {result,rerender}=renderHook(({people})=>useDriveTimes({people,from:origin,enabled:true,transport:'walking'}),{initialProps:{people:[person]}});
 await waitFor(()=>expect(result.current).toEqual({a:900}));
 expect(recorder.roadRoute).toHaveBeenLastCalledWith(origin,expect.objectContaining(person.position),'walking');
 rerender({people:[{...person,position:{...person.position,latitude:-33.7}}]});
 expect(result.current).toEqual({a:900});
 finish({routes:[{expectedSeconds:1200}]});
 await waitFor(()=>expect(result.current).toEqual({a:1200}));
 rerender({people:[]});
 expect(result.current).toEqual({});
});

it('expires the previous estimate if recalculation fails',async()=>{
 vi.useFakeTimers();
 try{
  const origin={latitude:-33.9,longitude:151.1};
  const lookup=vi.fn().mockResolvedValueOnce({routes:[{expectedSeconds:900}]}).mockRejectedValueOnce(new Error('Directions unavailable'));
  const {result,rerender}=renderHook(({latitude})=>useDriveTimes({
   people:[{userId:'a',state:'live',position:{latitude,longitude:151.2}}],
   from:origin,enabled:true,lookup
  }),{initialProps:{latitude:-33.8}});
  await act(async()=>{});
  expect(result.current).toEqual({a:900});
  rerender({latitude:-33.7});
  await act(()=>vi.advanceTimersByTimeAsync(299999));
  expect(result.current).toEqual({a:900});
  await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(result.current).toEqual({});
 }finally{
  vi.useRealTimers();
 }
});
