import {beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({currentPosition:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'ios'},registerPlugin:()=>native}));
import {POSITION_REUSE_SECONDS,forgetSharedPosition,recorder,sharedCurrentPosition} from './recorder.js';

const fix=(timestamp,accuracy=8)=>({latitude:-33.86,longitude:151.2,accuracy,speed:0,timestamp});

describe('one position for household, friends and the map',()=>{
 beforeEach(()=>{native.currentPosition.mockReset();forgetSharedPosition();});
 it('serves concurrent callers from one native request',async()=>{
  let resolve;native.currentPosition.mockReturnValue(new Promise(r=>{resolve=r;}));
  const household=recorder.currentPosition(),friends=recorder.currentPosition(),map=recorder.currentPosition();
  resolve(fix(Date.now()/1000));
  const [a,b,c]=await Promise.all([household,friends,map]);
  expect(native.currentPosition).toHaveBeenCalledTimes(1);
  expect(a).toBe(b);expect(b).toBe(c);
 });
 it('coalesces stationary-capable sharing calls and upgrades only once for the map',async()=>{
  let resolve;native.currentPosition.mockReturnValueOnce(new Promise(r=>{resolve=r;})).mockResolvedValueOnce(fix(Date.now()/1000));
  const household=recorder.currentPosition({allowStationary:true});
  const second=recorder.currentPosition({allowStationary:true});
  const map=recorder.currentPosition(),friend=recorder.currentPosition();
  expect(native.currentPosition).toHaveBeenCalledTimes(1);
  resolve({stationary:true,stationarySince:1});
  const values=await Promise.all([household,second,map,friend]);
  expect(values[0]).toMatchObject({stationary:true});expect(values[1]).toMatchObject({stationary:true});
  expect(values[2]).toMatchObject({accuracy:8});expect(values[3]).toEqual(values[2]);
  expect(native.currentPosition).toHaveBeenCalledTimes(2);
 });
 it('does not cache or deliver a previous account session’s in-flight position',async()=>{
  let resolve;native.currentPosition.mockReturnValueOnce(new Promise(r=>{resolve=r;})).mockResolvedValueOnce(fix(Date.now()/1000));
  const previous=recorder.currentPosition();
  forgetSharedPosition();
  const next=recorder.currentPosition();
  resolve(fix(Date.now()/1000));
  await expect(previous).rejects.toThrow('previous account');
  await expect(next).resolves.toMatchObject({accuracy:8});
  expect(native.currentPosition).toHaveBeenCalledTimes(2);
 });
 it('reuses a fix for 20 seconds by its own timestamp, then asks again',async()=>{
  const taken=1_800_000_000;
  native.currentPosition.mockResolvedValueOnce(fix(taken)).mockResolvedValueOnce(fix(taken+30));
  expect(await sharedCurrentPosition(taken+1)).toEqual(fix(taken));
  expect(await sharedCurrentPosition(taken+POSITION_REUSE_SECONDS)).toEqual(fix(taken));
  expect(native.currentPosition).toHaveBeenCalledTimes(1);
  // Older than 20 s: a new fix, never the old one presented as new.
  expect(await sharedCurrentPosition(taken+POSITION_REUSE_SECONDS+1)).toEqual(fix(taken+30));
  expect(native.currentPosition).toHaveBeenCalledTimes(2);
 });
 it('lets periodic refreshes accept the stationary report from Core Location instead of a new fix, without caching it as a position',async()=>{
  native.currentPosition.mockResolvedValueOnce({stationary:true,stationarySince:1}).mockResolvedValueOnce(fix(Date.now()/1000));
  const still=await recorder.currentPosition({allowStationary:true});
  expect(still).toEqual({stationary:true,stationarySince:1});
  expect(native.currentPosition).toHaveBeenLastCalledWith({allowStationary:true});
  expect(still).not.toHaveProperty('latitude');
  // A caller that needs a position (the map, turning sharing on) always gets a real fix.
  await expect(recorder.currentPosition()).resolves.toMatchObject({accuracy:8});
  expect(native.currentPosition).toHaveBeenLastCalledWith();
 });
 it('never caches a failure',async()=>{
  native.currentPosition.mockRejectedValueOnce(new Error('No recent location fix')).mockResolvedValueOnce(fix(Date.now()/1000));
  await expect(recorder.currentPosition()).rejects.toThrow('No recent location fix');
  await expect(recorder.currentPosition()).resolves.toMatchObject({accuracy:8});
  expect(native.currentPosition).toHaveBeenCalledTimes(2);
 });
});
