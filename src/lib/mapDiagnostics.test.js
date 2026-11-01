import {afterEach,describe,expect,it} from 'vitest';
import {installMapDiagnostics,mapDiagnosticsEnabled,recordMapEvent,recordMapFrame,resetMapDiagnostics,snapshot} from './mapDiagnostics.js';

afterEach(()=>{resetMapDiagnostics();localStorage.clear();});
describe('map lifecycle counters',()=>{
 it('counts each lifecycle call separately and keeps a snapshot readable',()=>{
  localStorage.setItem('letm3go-map-diagnostics','1');
  recordMapEvent('embed',{mapID:'a'});recordMapEvent('embed');recordMapEvent('resize');
  const state=snapshot();
  expect(state.events).toMatchObject({embed:2,resize:1,update:0,snapshot:0,hide:0,unembed:0});
  expect(state.events).toHaveProperty('scroll-ignored',0);
 });
 it('records frame durations with a bounded buffer and honest aggregates',()=>{
  localStorage.setItem('letm3go-map-diagnostics','1');
  for(let index=0;index<200;index++)recordMapFrame(16+(index%4));
  const state=snapshot();
  expect(state.frames.kind).toBe('js-rAF');
  expect(state.frames.count).toBe(120);
  expect(state.frames.worst).toBe(19);
  expect(state.frames.average).toBeGreaterThan(16);
  recordMapFrame(-1);recordMapFrame(NaN);
  expect(snapshot().frames.count).toBe(120);
 });
 it('resets between measurements and exposes the data to the device',()=>{
  localStorage.setItem('letm3go-map-diagnostics','1');
  recordMapEvent('embed');
  expect(window.__letm3goMapEvents.events.embed).toBe(1);
  resetMapDiagnostics();
  expect(snapshot().events.embed).toBe(0);
  expect(window.__letm3goMapEvents).toBeUndefined();
  expect(window.letm3goMapDiagnostics).toBeUndefined();
 });
 it('installs the device reader only while a map is live',()=>{
  localStorage.setItem('letm3go-map-diagnostics','1');
  let reads=0;
  const release=installMapDiagnostics(()=>{reads+=1;});
  expect(typeof window.letm3goMapDiagnostics).toBe('function');
  expect(window.letm3goMapDiagnostics().events.embed).toBe(0);
  expect(reads).toBe(1);
  release();
  expect(window.letm3goMapDiagnostics).toBeUndefined();
 });
 it('pays nothing and stays silent until it is opted into',()=>{
  recordMapEvent('embed');
  recordMapFrame(16);
  expect(snapshot().events.embed).toBe(0);
  expect(snapshot().frames.count).toBe(0);
  expect(window.__letm3goMapEvents).toBeUndefined();
  expect(window.letm3goMapDiagnostics).toBeUndefined();
  localStorage.setItem('letm3go-map-diagnostics','1');
  recordMapEvent('embed');
  recordMapFrame(16);
  expect(snapshot().events.embed).toBe(1);
  expect(snapshot().frames.count).toBe(1);
 });
 it('is opt-in',()=>{
  expect(mapDiagnosticsEnabled()).toBe(false);
  localStorage.setItem('letm3go-map-diagnostics','1');
  expect(mapDiagnosticsEnabled()).toBe(true);
 });
});
