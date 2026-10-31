import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {packJourneys,unpackJourneys} from './overviewTransfer.js';
import {overviewKey} from './mapOverview.js';

const street=(lon,count=30)=>Array.from({length:count},(_,i)=>[-33.86-i*0.00018,lon]);
const trip=(id,lon,extra={})=>({id,startedAt:1000,title:id,routeSegments:[street(lon)],photos:[{id:`${id}-p`,point:[-33.86,lon]}],...extra});
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

describe('transfer to the worker',()=>{
 it('keeps segment breaks and invalid samples, and the same overview key',()=>{
  const journeys=[trip('a',151.2),{id:'b',startedAt:5,routeSegments:[[[-33.9,151.1],[NaN,151.1],null,[-33.91,151.1]],[[-33.95,151.15],[-33.96,151.15]]],photos:[]}];
  const packed=packJourneys(journeys);
  expect(packed.coordinates).toBeInstanceOf(Float64Array);
  const back=unpackJourneys(structuredClone(packed));
  expect(back[0].routeSegments).toEqual(journeys[0].routeSegments);
  // Invalid samples become explicit breaks before transfer; neither side is joined.
  expect(back[1].routeSegments).toEqual([[[-33.9,151.1]],[[-33.91,151.1]],[[-33.95,151.15],[-33.96,151.15]]]);
  expect(overviewKey(back)).toBe(overviewKey(journeys));
 });
});

describe('without worker support',()=>{
 it('computes off the render path and never returns another filter\'s overview',async()=>{
  vi.stubGlobal('Worker',undefined);
  const {useMapOverview}=await import('./useMapOverview.js');
  const first=[trip('a',151.2)],second=[trip('b',151.3)];
  const {result,rerender}=renderHook(({journeys})=>useMapOverview(journeys),{initialProps:{journeys:first}});
  expect(result.current).toMatchObject({overview:null,pending:true});
  await waitFor(()=>expect(result.current.overview?.photos[0].journeyID).toBe('a'));
  rerender({journeys:second});
  // Never the previous journeys' routes while the new ones are prepared.
  expect(result.current.overview).toBeNull();
  await waitFor(()=>expect(result.current.overview?.photos[0].journeyID).toBe('b'));
  rerender({journeys:[]});
  expect(result.current).toMatchObject({overview:null,pending:false});
 });
});

describe('with a worker',()=>{
 class FakeWorker{
  static instances=[];
  constructor(){this.listeners={message:[],error:[]};this.posted=[];FakeWorker.instances.push(this);}
  addEventListener(type,fn){this.listeners[type].push(fn);}
  removeEventListener(type,fn){this.listeners[type]=this.listeners[type].filter(f=>f!==fn);}
  postMessage(data){this.posted.push(data);}
  terminate(){this.terminated=true;}
  reply(index,payload){const id=this.posted[index].id;for(const fn of [...this.listeners.message])fn({data:{id,...payload}});}
  fail(){for(const fn of [...this.listeners.error])fn(new Event('error'));}
 }
 const answer=journeys=>({overview:{key:overviewKey(journeys),levels:[],photos:[],routes:{}}});
 it('runs one calculation at a time and only the latest request waits behind it',async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);
  const {useMapOverview}=await import('./useMapOverview.js');
  const a=[trip('a',151.2)],b=[trip('b',151.3)],c=[trip('c',151.4)];
  const {result,rerender}=renderHook(({journeys})=>useMapOverview(journeys),{initialProps:{journeys:a}});
  const worker=FakeWorker.instances[0];
  expect(worker.posted).toHaveLength(1);
  rerender({journeys:b});rerender({journeys:c});
  expect(worker.posted).toHaveLength(1);
  // The answer for a is no longer wanted; c is sent next, b never is.
  act(()=>worker.reply(0,answer(a)));
  expect(result.current.overview).toBeNull();
  expect(worker.posted).toHaveLength(2);
  expect(unpackJourneys(worker.posted[1])[0].id).toBe('c');
  act(()=>worker.reply(1,answer(c)));
  expect(result.current.overview.key).toBe(overviewKey(c));
  // Same journeys again (new objects, same content): nothing is recalculated.
  rerender({journeys:[trip('c',151.4)]});
  expect(worker.posted).toHaveLength(2);
 });
 it('reports a failure, and retries without a worker that cannot run',async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);
  const {useMapOverview}=await import('./useMapOverview.js');
  const a=[trip('a',151.2)];
  const {result}=renderHook(()=>useMapOverview(a));
  act(()=>FakeWorker.instances[0].fail());
  expect(result.current).toMatchObject({overview:null,pending:false,error:'Routes could not be prepared.'});
  expect(FakeWorker.instances[0].terminated).toBe(true);
  act(()=>result.current.retry());
  await waitFor(()=>expect(result.current.overview?.key).toBe(overviewKey(a)));
  expect(result.current.error).toBe('');
 });
});
