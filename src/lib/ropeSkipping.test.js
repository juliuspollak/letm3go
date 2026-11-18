import {describe,expect,it} from 'vitest';
import {backupRope,clockText,jumpsText,ropeSummary,typesWithCurrent} from './ropeSkipping.js';
import {activityCapabilities} from './activityCapabilities.js';
import {activitySummary} from './activitySummary.js';
import {viewMetadata} from './cloudSync.js';
import {activityPresentation} from './activityPresentation.js';
import {precisionOffered} from './gpsPrecision.js';

const skipping=(overrides={})=>({jumps:1250,totalSeconds:900,activeSeconds:690,restSeconds:210,intervalCount:8,averageCadence:108.7,
 intervals:[{start:1000,end:1300,jumps:600},{start:1500,end:1900,jumps:650}],...overrides});
const trip=(details={},extra={})=>({id:'t1',activity:'Rope skipping',source:'watch',title:'Rope skipping',date:'2026-11-17',durationSeconds:900,minutes:15,
 distanceMeters:0,distance:0,points:[],details:{indoor:true,ropeSkipping:skipping(),...details},...extra});
const labels=entries=>Object.fromEntries(entries.map(e=>[e.label,e.value]));

describe('rope skipping summary',()=>{
 it('reads the saved totals and keeps active plus rest equal to the total',()=>{
  const s=ropeSummary(trip());
  expect(s).toMatchObject({jumps:1250,totalSeconds:900,activeSeconds:690,restSeconds:210,intervalCount:8});
  expect(s.averageCadence).toBeCloseTo(108.7,1);
  expect(s.activeSeconds+s.restSeconds).toBe(s.totalSeconds);
 });
 it('only applies to rope skipping and ignores broken values',()=>{
  expect(ropeSummary({activity:'Gym',details:{ropeSkipping:skipping()}})).toBeNull();
  expect(ropeSummary(trip({ropeSkipping:undefined}))).toBeNull();
  for(const bad of [{jumps:-1},{jumps:'12'},{jumps:1e9},{totalSeconds:NaN},{totalSeconds:-4}])expect(ropeSummary(trip({ropeSkipping:skipping(bad)}))).toBeNull();
  const clamped=ropeSummary(trip({ropeSkipping:skipping({activeSeconds:5000})}));
  expect(clamped.activeSeconds).toBe(900);expect(clamped.restSeconds).toBe(0);
 });
 it('formats times as clocks and jumps with separators',()=>{
  expect(clockText(690)).toBe('11:30');expect(clockText(210)).toBe('3:30');expect(clockText(3930)).toBe('1:05:30');expect(clockText(NaN)).toBe('0:00');
  expect(jumpsText(1250)).toBe('1,250');
 });
 it('treats rope skipping like Gym for GPS, and leaves other activities alone',()=>{
  expect(activityCapabilities('Gym').gps||activityCapabilities('Rope skipping').gps).toBe(false);
  expect(activityCapabilities('MTB').gps&&activityCapabilities('Walking').gps).toBe(true);
  expect(precisionOffered('Rope skipping')||precisionOffered('Gym')||precisionOffered('Driving')).toBe(false);expect(precisionOffered('MTB')).toBe(true);
 });
 it('keeps the type an activity already has in a picker',()=>{
  expect(typesWithCurrent(['Gym','Other'],'Rope skipping')).toEqual(['Gym','Other','Rope skipping']);
  expect(typesWithCurrent(['Gym','Other'],'Gym')).toEqual(['Gym','Other']);
 });
});

describe('rope skipping on the activity detail',()=>{
 it('leads with jumps and shows cadence, skipping, rest and intervals but no GPS figures',()=>{
  const entries=activitySummary(trip());
  expect(entries.map(e=>e.id).slice(0,2)).toEqual(['jumps','elapsed']);
  expect(labels(entries)).toMatchObject({Jumps:'1,250',Time:'15:00','Avg cadence':'109 /min','Active skipping':'11:30',Rest:'3:30','Skipping intervals':'8'});
  expect(entries.some(e=>/distance|elevation|speed|pace/i.test(e.label))).toBe(false);
 });
 it('shows heart rate and calories from the existing integration',()=>{
  const entries=activitySummary(trip({heartRate:{summary:{average:132,maximum:171}},activeEnergy:210,activeEnergyUnit:'kcal',energySource:'healthkit'}));
  expect(labels(entries)).toMatchObject({'Avg heart rate':'132 BPM'});
  expect(entries.some(e=>e.id==='calories')).toBe(true);
 });
 it('omits cadence when nothing was skipped and a rope workout with no data stays plain',()=>{
  const none=activitySummary(trip({ropeSkipping:skipping({jumps:0,activeSeconds:0,intervalCount:0,intervals:[]})}));
  expect(none.some(e=>e.id==='cadence')).toBe(false);expect(labels(none).Jumps).toBe('0');
  const missing=activitySummary(trip({ropeSkipping:undefined}));
  expect(missing.some(e=>e.id==='jumps')).toBe(false);
 });
 it('leaves Gym and Cycling subtypes as they were',()=>{
  const gym=activitySummary({activity:'Gym',durationSeconds:1800,details:{indoor:true}});
  expect(gym.map(e=>e.id)).toEqual(['elapsed']);
  const gymWithStray=activitySummary({activity:'Gym',durationSeconds:600,details:{indoor:true,ropeSkipping:skipping()}});
  expect(gymWithStray.some(e=>e.id==='jumps')).toBe(false);
  const ride=activitySummary({activity:'MTB',distanceMeters:12000,durationSeconds:3600,details:{movingSeconds:3000}});
  expect(ride.map(e=>e.id)).toEqual(['distance','moving','elapsed']);
 });
 it('includes rope motion and the jump tally in feedback without GPS diagnostics',()=>{
  const trace='Rope motion v2\nelapsed_ms,upward_milli_g,magnitude_milli_g,count,last_confirmed_jump_ms,session\n20,640,650,1,0,1';
  const view=activityPresentation(trip({ropeMotionTrace:trace}),{segmentReport:['GPS segment matching']});
  expect(view.diagnostics.report).toContain('Jumps: 1250');
  expect(view.diagnostics.report).toContain(trace);
  expect(view.diagnostics.report).not.toMatch(/GPS|distance/i);
  expect(view.diagnostics.warnings).toEqual([]);
  expect(view.header.routeMap).toBe(false);
 });
 it('omits legacy distance and routes on shared rope skipping workouts',()=>{
  const shared=trip({}, {isShared:true,readOnly:true,distance:1.5,route:[[-34,151],[-34.01,151]]});
  const view=activityPresentation(shared);
  expect(view.header.routeMap).toBe(false);
  expect(view.summary.map(item=>item.id)).toEqual(['duration','date']);
  expect(view.map.routes).toEqual([]);
 });
 it('explains the missing route as indoor and offers the type it already has',()=>{
  const presentation=activityPresentation(trip(),{ownerID:'o'});
  expect(presentation.noRouteDetail||JSON.stringify(presentation)).toMatch(/Indoor activity/);
  expect(presentation.summary.map(s=>s.label)).toContain('Jumps');
  const values=(presentation.editor?.types||[]).map(t=>t.value);
  expect(values).toContain('Rope skipping');expect(values).toContain('Gym');
 });
});

describe('rope skipping backup',()=>{
 it('backs up only bounded numbers and no rest or cadence, which are derived',()=>{
  const backed=backupRope(skipping());
  expect(Object.keys(backed).sort()).toEqual(['activeSeconds','intervalCount','intervals','jumps','totalSeconds']);
  expect(viewMetadata({ropeSkipping:skipping()}).ropeSkipping).toEqual(backed);
 });
 it('drops what cannot be trusted and bounds the list',()=>{
  expect(backupRope(null)).toBeNull();expect(backupRope(skipping({jumps:-5}))).toBeNull();expect(backupRope(skipping({totalSeconds:NaN}))).toBeNull();
  const many=backupRope(skipping({intervals:Array.from({length:500},(_,i)=>({start:i,end:i+1,jumps:2}))}));
  expect(many.intervals).toHaveLength(200);expect(many.intervalCount).toBe(200);
  expect(backupRope(skipping({intervals:[{start:5,end:1,jumps:3},{start:1,end:2,jumps:0},null]})).intervals).toEqual([]);
  expect(backupRope(skipping({activeSeconds:5000})).activeSeconds).toBe(900);
 });
 it('leaves other activities and the other view keys alone',()=>{
  expect(viewMetadata({startPlace:'Home',visibleRouteStart:2})).toEqual({startPlace:'Home',visibleRouteStart:2});
  expect(viewMetadata({ropeSkipping:{jumps:'x'}}).ropeSkipping).toBeUndefined();
 });
});

import {activityFromCloudRow} from './cloudActivity.js';
describe('rope skipping after a restore',()=>{
 it('comes back from the cloud row with the same readouts',()=>{
  const view=viewMetadata({ropeSkipping:skipping()});
  const row={id:'33333333-3333-4333-8333-333333333333',owner_id:'o',title:'Rope skipping',activity:'Rope skipping',recording_mode:'watch',started_at:'2026-11-17T00:00:00Z',ended_at:'2026-11-17T00:15:00Z',duration_seconds:900,distance_meters:0,route_points:[],view_metadata:view,classification:{}};
  const restored=activityFromCloudRow(row,{detail:true});
  expect(restored.activity).toBe('Rope skipping');
  expect(labels(activitySummary(restored))).toMatchObject({Jumps:'1,250','Active skipping':'11:30',Rest:'3:30','Skipping intervals':'8'});
  expect(labels(activitySummary(restored))).toEqual(labels(activitySummary(trip({ropeSkipping:skipping()}))));
 });
});
