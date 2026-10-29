import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({currentPosition:vi.fn(),setAdaptiveLocation:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'ios'},registerPlugin:()=>native}));
import {POSITION_REUSE_SECONDS,forgetSharedPosition,recorder,sharedCurrentPosition} from './recorder.js';
import {adaptiveFindings,adaptiveRows,duration} from './adaptiveDiagnostics.js';
import {trackingFindings} from './trackingReport.js';
import TrackingPermissions from '../components/TrackingPermissions.jsx';

afterEach(cleanup);
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

describe('adaptive engine diagnostics',()=>{
 const adaptive={enabled:true,supported:true,state:'stationaryStandby',secondsInState:7260,engine:'lowPower',liveUpdatesRunning:true,coreLocationStationary:true,
  placeRegionMonitored:true,timeInStateSeconds:{stationaryStandby:28800,settling:600},liveUpdatesSeconds:28800,liveUpdatesActivations:2,standbyWakes:3,probeLoopsBlocked:1,
  liveUpdatesFailures:0,recoveryUntil:null,lastDepartureLatency:{engine:'lowPower',cause:'lowPower: Core Location reported movement',evidenceToFirstFixSeconds:'4',evidenceToConfirmationSeconds:'41',at:'1'}};
 const state={adaptive,trackingUsage:{continuousSeconds:900,continuousStarts:5},nativeFamilySharing:{armed:true,status:'ok',lastUploadOkAt:0}};
 it('shows the state, which engine runs standby, totals and the last departure latency',()=>{
  const rows=Object.fromEntries(adaptiveRows(state));
  expect(rows['Location state']).toBe('Settled · stationary standby · 2 h 1 min');
  expect(rows['Standby engine']).toBe('Low-power: continuous location stopped');
  expect(rows['Core Location low-power updates']).toBe('Running · phone reported stationary');
  expect(rows['Time stationary (this session)']).toBe('8 h');
  expect(rows['Continuous GPS total']).toBe('15 min · 5 activations');
  expect(rows['Low-power wake-ups']).toBe('3 · 1 repeated wake-ups held back');
  expect(rows['Last departure']).toContain('first GPS 4 s, confirmed 41 s');
  expect(rows['Household location upload']).toBe('ok');
  expect(adaptiveRows({})).toEqual([]);
  expect(Object.fromEntries(adaptiveRows({adaptive:{...adaptive,enabled:true,supported:false,engine:'established'}}))['Adaptive engine']).toContain('needs iOS 17');
  expect(duration(45)).toBe('45 s');expect(duration(NaN)).toBe('Not reported');
 });
 it('summarises an overnight stationary period from the logged transitions, without coordinates',()=>{
  const night=22*3600,morning=30*3600;
  const report={start:night,end:morning,events:[
   {at:night-600,kind:'adaptive',message:'Location state: settling',context:{to:'settling'}},
   {at:night+300,kind:'adaptive',message:'Location state: stationaryStandby',context:{to:'stationaryStandby'}},
   {at:night+300,kind:'decision',message:'Low-power standby: continuous location stopped; Core Location will report movement',context:{}},
   {at:morning-600,kind:'decision',message:'Low-power standby woke: Core Location reported movement',context:{}},
   {at:morning-600,kind:'adaptive',message:'Location state: departureProbe',context:{to:'departureProbe'}},
   {at:morning-560,kind:'detection',message:'Departure latency',context:{engine:'lowPower',cause:'lowPower: Core Location reported movement',evidenceToFirstFixSeconds:'4',evidenceToConfirmationSeconds:'40'}},
   {at:morning-540,kind:'adaptive',message:'Location state: activeJourney',context:{to:'activeJourney'}}
  ]};
  const findings=adaptiveFindings(report);
  expect(findings[0]).toContain('Settled · stationary standby: 7 h 45 min');
  expect(findings[0]).toContain('Settling · standard standby: 5 min');
  expect(findings[1]).toMatch(/^1 entries into low-power standby, 1 low-power wake-ups/);
  expect(findings.at(-1)).toContain('first GPS 4 s and confirmation 40 s');
  expect(trackingFindings(report)).toEqual(expect.arrayContaining(findings));
  expect(JSON.stringify(findings)).not.toMatch(/latitude|longitude|-33\./);
  expect(adaptiveFindings({start:0,end:10,events:[]})).toEqual([]);
 });
});

describe('Tracking & Permissions',()=>{
 it('offers the adaptive switch only when the native engine reports it, and changes it explicitly',()=>{
  const run=vi.fn();
  const {rerender}=render(<TrackingPermissions recording={{state:{permission:'always',automaticEnabled:true,storageReady:true},run}} onBack={vi.fn()}/>);
  expect(screen.queryByRole('switch',{name:'Adaptive location (testing)'})).toBeNull();
  rerender(<TrackingPermissions recording={{state:{permission:'always',automaticEnabled:true,storageReady:true,automaticSampling:'lowPowerStandby',adaptive:{enabled:false,supported:true,state:'settling'}},run}} onBack={vi.fn()}/>);
  const toggle=screen.getByRole('switch',{name:'Adaptive location (testing)'});
  expect(toggle).toHaveAttribute('aria-checked','false');
  fireEvent.click(toggle);
  expect(run).toHaveBeenCalledWith('setAdaptiveLocation',true);
  expect(screen.getByText('Native state').nextSibling).toHaveTextContent('Low-power standby (continuous location stopped)');
  expect(screen.getByText('Adaptive engine').nextSibling).toHaveTextContent('Off · established engine');
 });
});
