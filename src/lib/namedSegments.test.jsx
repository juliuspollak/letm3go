import {cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
const mapCalls=vi.hoisted(()=>[]);
vi.mock('../components/ActivityPrivacy.jsx',()=>({default:()=>null}));
vi.mock('../components/JourneyMap.jsx',()=>({default:props=>{mapCalls.push(props);return <div aria-label="Activity map"/>;}}));
import {recordedJourney} from './recorder.js';
import {SEGMENT_MIN_METRES,canCreateSegments,cleanSegmentName,namedSegments,segmentColor,segmentLayers,segmentRuns,segmentStats} from './namedSegments.js';
afterEach(()=>{cleanup();mapCalls.length=0;});

// 40 fixes, 10 s and ~22 m apart, heading north; a 5-minute GPS gap after fix 19.
const points=Array.from({length:40},(_,i)=>({latitude:-33.9+i*0.0002,longitude:151.2,timestamp:1000+i*10+(i>=20?300:0),accuracy:5,altitude:0,speed:2,segment:i>=20?1:0}));
const ride=(extra={})=>recordedJourney({id:'ride',title:'Morning ride',activity:'MTB',state:'finished',source:'device',recordingMode:'manual',startedAt:1000,endedAt:points.at(-1).timestamp,distanceMeters:800,durationSeconds:690,points,...extra});
const saved=(id,name,startIndex,endIndex,colorIndex=0)=>({id,name,startIndex,endIndex,startTimestamp:points[startIndex].timestamp,endTimestamp:points[endIndex].timestamp,distanceMeters:300,durationSeconds:120,gapSeconds:0,pointCount:endIndex-startIndex+1,colorIndex,geometry:[],visibility:'private',createdAt:1,updatedAt:1});

describe('segment rules (mirroring NamedSegmentCore.swift)',()=>{
 it('allow recorded walks, runs, hikes and rides with GPS, never drives, Tesla or manual entries',()=>{
  expect(canCreateSegments(ride())).toBe(true);
  expect(canCreateSegments(ride({activity:'Hiking',source:'watch'}))).toBe(true);
  expect(canCreateSegments(ride({activity:'Driving'}))).toBe(false);
  expect(canCreateSegments(ride({recordingMode:'historical'}))).toBe(false);
  expect(canCreateSegments(ride({source:'cloud'}))).toBe(false);
  expect(canCreateSegments(ride({state:'recording'}))).toBe(false);
  expect(canCreateSegments(ride({points:points.slice(0,4)}))).toBe(false);
 });
 it('measure only observed route: the gap is neither drawn nor counted',()=>{
  const across=segmentStats(ride(),15,25),within=segmentStats(ride(),0,10);
  expect(within.distanceMeters).toBeGreaterThan(200);
  expect(across.gapSeconds).toBe(310);
  expect(across.distanceMeters).toBeLessThan(10*22.3+1);
  expect(segmentRuns(points,15,25).map(run=>run.length)).toEqual([5,6]);
  expect(across.durationSeconds).toBe(points[25].timestamp-points[15].timestamp);
 });
 it('enforce a minimum number of points and length',()=>{
  expect(segmentStats(ride(),0,3).problem).toBe('points');
  expect(segmentStats(ride(),0,1).valid).toBe(false);
  const still=points.map(p=>({...p,latitude:-33.9}));
  expect(segmentStats(ride({points:still}),0,10).problem).toBe('short');
  expect(SEGMENT_MIN_METRES).toBe(50);
 });
 it('require a name of up to 80 characters',()=>{
  expect(cleanSegmentName('  Rock   Garden  Descent ')).toBe('Rock Garden Descent');
  expect(cleanSegmentName('   ')).toBeNull();
  expect(cleanSegmentName('x'.repeat(81))).toBeNull();
 });
 it('ignore a saved segment whose fixes no longer match',()=>{
  const trip=ride({details:{namedSegments:[saved('a','A',2,12),{...saved('b','B',2,12),startTimestamp:5}]}});
  expect(namedSegments(trip).map(s=>s.id)).toEqual(['a']);
 });
 it('draw saved segments in their own colours with labels, and mute the route only while choosing',()=>{
  const trip=ride({details:{namedSegments:[saved('a','Rock Garden Descent',2,12,0),saved('b','Climb',8,18,1)]}});
  const view=segmentLayers(trip);
  expect(view.muted).toBe(false);
  expect(view.pins.map(p=>[p.kind,p.title,p.color])).toEqual([['segment','Rock Garden Descent',segmentColor(0)],['segment','Climb',segmentColor(1)]]);
  expect(segmentColor(0)).not.toBe(segmentColor(1));
  const editing=segmentLayers(trip,{selection:{start:15,end:25},editingID:'b'});
  expect(editing.muted).toBe(true);
  expect(editing.pins.map(p=>p.title)).toEqual(['Rock Garden Descent']);
  // The selection across the gap is two lines, never one bridging it.
  expect(editing.styled.filter(s=>s.color==='#FF2D55').map(s=>s.points.length)).toEqual([5,6]);
 });
});

describe('cloud backup of segments',()=>{
 it('backs up private references with the required migration, and never sends a geometry copy',async()=>{
  const {NAMED_SEGMENT_BACKUP,backupSegments}=await import('./cloudSync.js');
  expect(NAMED_SEGMENT_BACKUP).toBe(true);
  const out=backupSegments([{...saved('a1b2c3d4-0000-4000-8000-000000000001','A',2,12),geometry:[[[1,2],[3,4]]],visibility:'public'},saved('short','B',2,12)]);
  expect(out).toHaveLength(1);
  expect(out[0].geometry).toBeUndefined();
  expect(out[0].visibility).toBe('private');
 });
});

describe('destructive trimming',()=>{
 it('names every segment a trim would delete, and none it keeps',async()=>{
  const {segmentsCutByTrim}=await import('./namedSegments.js');
  const trip=ride({details:{namedSegments:[saved('a','Rock Garden Descent',2,12),saved('b','Climb',8,18),saved('c','Finish',30,39)]}});
  expect(segmentsCutByTrim(trip,5,39).map(s=>s.name)).toEqual(['Rock Garden Descent']);
  expect(segmentsCutByTrim(trip,0,35).map(s=>s.name)).toEqual(['Finish']);
  expect(segmentsCutByTrim(trip,2,39)).toEqual([]);
 });
});
