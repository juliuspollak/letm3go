import {describe,expect,it} from 'vitest';
import {activityCapabilities,capabilitiesOf,usesGPS,workoutFigure} from './activityCapabilities.js';
import {activitySummary} from './activitySummary.js';
import {activityPresentation} from './activityPresentation.js';
import {precisionOffered} from './gpsPrecision.js';

const OUTDOOR=['Driving','Walking','Running','Cycling','MTB','Mountain biking','Road cycling','Hiking','Kitesurfing','Other','Unknown'];
const trip=(activity,extra={},details={})=>({id:'t',activity,source:'watch',title:activity,date:'2026-11-17',durationSeconds:900,minutes:15,distanceMeters:8200,distance:8.2,points:[],details,...extra});

describe('activity capabilities',()=>{
 it('records GPS and a route map for every outdoor activity',()=>{
  for(const a of OUTDOOR)expect(activityCapabilities(a),a).toEqual({gps:true,routeMap:true});
 });
 it('records neither for Gym and its Rope skipping subtype',()=>{
  expect(activityCapabilities('Gym')).toEqual({gps:false,routeMap:false});
  expect(activityCapabilities('Rope skipping')).toEqual({gps:false,routeMap:false});
 });
 it('lets an indoor choice override the parent, and leaves an outdoor one alone',()=>{
  expect(activityCapabilities('Walking',{indoor:true}).gps).toBe(false);  // treadmill
  expect(activityCapabilities('Cycling',{indoor:true}).gps).toBe(false);  // indoor cycling
  expect(activityCapabilities('Running',{indoor:false}).gps).toBe(true);
  expect(activityCapabilities('Running',{}).gps).toBe(true);
 });
 it('reads the activity of a saved record, so older records are interpreted the same way',()=>{
  expect(usesGPS(trip('Gym'))).toBe(false);
  expect(usesGPS(trip('Walking',{},{indoor:true}))).toBe(false);
  expect(usesGPS(trip('MTB'))).toBe(true);
  expect(usesGPS({activity:'Driving'})).toBe(true);
  expect(usesGPS(undefined)).toBe(true);   // unknown stays a GPS activity, never silently indoor
  expect(capabilitiesOf(trip('Hiking'))).toEqual({gps:true,routeMap:true});
 });
 it('asks for GPS precision only where there is GPS to tune',()=>{
  expect(precisionOffered('MTB')).toBe(true);
  for(const a of ['Driving','Gym','Rope skipping'])expect(precisionOffered(a)).toBe(false);
 });
});

describe('what a list row leads with',()=>{
 it('is the distance for a GPS activity, jumps for rope skipping, minutes for other workouts',()=>{
  expect(workoutFigure(trip('Cycling'))).toBeNull();
  expect(workoutFigure(trip('Rope skipping',{distanceMeters:0},{indoor:true,ropeSkipping:{jumps:1248,totalSeconds:900,activeSeconds:700,intervalCount:6,intervals:[]}}))).toEqual({value:'1,248',label:'jumps'});
  expect(workoutFigure(trip('Gym',{distanceMeters:0,durationSeconds:1800},{indoor:true}))).toEqual({value:'30',label:'min'});
  expect(workoutFigure(trip('Walking',{distanceMeters:0,durationSeconds:600},{indoor:true}))).toEqual({value:'10',label:'min'});
 });
 it('falls back to minutes when rope skipping has no readable summary',()=>{
  expect(workoutFigure(trip('Rope skipping',{distanceMeters:0},{indoor:true}))).toEqual({value:'15',label:'min'});
 });
});

describe('detail presentation follows the capabilities and the data',()=>{
 const header=t=>activityPresentation(t,{ownerID:'o'}).header;
 it('leads with the route map for GPS activities and never for workouts without GPS',()=>{
  expect(header(trip('Cycling')).routeMap).toBe(true);
  expect(header(trip('Gym',{},{indoor:true})).routeMap).toBe(false);
  expect(header(trip('Rope skipping',{},{indoor:true})).routeMap).toBe(false);
  expect(header(trip('Running',{},{indoor:true})).routeMap).toBe(false);
 });
 it('says an intentional absence of GPS differently from a GPS activity that lost its route',()=>{
  expect(header(trip('Gym',{},{indoor:true})).noRouteDetail).toMatch(/Indoor activity/);
  const missing=header(trip('Cycling'));
  expect(missing.routeMap).toBe(true);                       // the screen keeps its map and says the route is missing
  expect(missing.noRouteDetail).not.toMatch(/Indoor/);
  expect(missing.noRouteDetail).toMatch(/GPS/);
 });
 it('shows no GPS figures for a workout and still shows duration, heart rate and calories',()=>{
  const gym=activitySummary(trip('Gym',{distanceMeters:0},{indoor:true,heartRate:{summary:{average:121,maximum:150}},activeEnergy:140,activeEnergyUnit:'kcal',energySource:'healthkit'}));
  expect(gym.map(e=>e.id)).toEqual(['elapsed','heart','calories']);
  const treadmill=activitySummary(trip('Running',{distanceMeters:0},{indoor:true}));
  expect(treadmill.some(e=>/distance|elevation/i.test(e.label))).toBe(false);
 });
 it('keeps every GPS figure for a GPS activity, with or without a saved route',()=>{
  const ride=activitySummary(trip('MTB',{},{movingSeconds:800}));
  expect(ride.map(e=>e.id)).toEqual(['distance','moving','elapsed']);
 });
 it('opens a shared workout without a route as a workout',()=>{
  const shared={...trip('Rope skipping',{distanceMeters:0,readOnly:true,sharedOwnerID:'friend'},{indoor:true,ropeSkipping:{jumps:300,totalSeconds:400,activeSeconds:300,intervalCount:3,intervals:[]}})};
  const p=activityPresentation(shared,{ownerID:'viewer'});
  expect(p.header.routeMap).toBe(false);
  expect(p.summary.map(s=>s.label)).toContain('Jumps');
 });
});
