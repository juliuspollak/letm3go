import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOUNDARY_INTERVAL_MS,BOUNDARY_SETTLE_MS,createBoundaryReporter} from './overlayTouch.js';

describe('sheet boundary reports',()=>{
 beforeEach(()=>{vi.useFakeTimers();});
 afterEach(()=>{vi.useRealTimers();});
 const drag=async(reporter,from,steps,by=6)=>{for(let i=1;i<=steps;i++){reporter.update(from+i*by);await vi.advanceTimersByTimeAsync(16);}};

 it('reports the first edge at once as settled',async()=>{
  const send=vi.fn().mockResolvedValue({});
  createBoundaryReporter(send).update(378.4);
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledExactlyOnceWith({height:378,moving:false});
 });
 it('tracks a moving sheet well below the frame rate and always sends the newest edge',async()=>{
  const send=vi.fn().mockResolvedValue({});
  const reporter=createBoundaryReporter(send);
  reporter.update(300);await vi.advanceTimersByTimeAsync(0);send.mockClear();
  await drag(reporter,300,30);
  const moving=send.mock.calls.map(([state])=>state);
  expect(moving.length).toBeGreaterThan(5);
  expect(moving.length).toBeLessThanOrEqual(Math.ceil(30*16/BOUNDARY_INTERVAL_MS)+1);
  expect(moving.every(state=>state.moving)).toBe(true);
  expect(moving.at(-1).height).toBeGreaterThan(450);
 });
 it('finishes with the exact edge once the sheet stops',async()=>{
  const send=vi.fn().mockResolvedValue({});
  const reporter=createBoundaryReporter(send);
  reporter.update(300);await drag(reporter,300,10);
  await vi.advanceTimersByTimeAsync(BOUNDARY_SETTLE_MS+1);
  expect(send).toHaveBeenLastCalledWith({height:360,moving:false});
 });
 it('never overlaps calls: a slow bridge gets only the latest edge',async()=>{
  let release;const send=vi.fn(()=>new Promise(resolve=>{release=resolve;}));
  const reporter=createBoundaryReporter(send);
  reporter.update(300);await vi.advanceTimersByTimeAsync(0);
  await drag(reporter,300,10);
  expect(send).toHaveBeenCalledTimes(1);
  release();await vi.advanceTimersByTimeAsync(BOUNDARY_INTERVAL_MS);
  expect(send.mock.calls[1][0].height).toBe(360);
 });
 it('sends nothing for an unchanged edge, and nothing at all once disposed',async()=>{
  const send=vi.fn().mockResolvedValue({});
  const reporter=createBoundaryReporter(send);
  reporter.update(300);await vi.advanceTimersByTimeAsync(0);
  reporter.update(300.2);await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(1);
  reporter.update(320);reporter.dispose();reporter.update(340);
  await vi.advanceTimersByTimeAsync(1000);
  expect(send.mock.calls.filter(([state])=>state.height===340)).toEqual([]);
 });
});
