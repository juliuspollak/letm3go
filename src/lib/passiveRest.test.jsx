import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({currentPosition:vi.fn(),setPassiveRest:vi.fn(),setSharingRest:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'ios'},registerPlugin:()=>native}));
import {recorder} from './recorder.js';
import {passiveRows} from './passiveRestDiagnostics.js';
import TrackingPermissions from '../components/TrackingPermissions.jsx';

afterEach(cleanup);
const passive=(overrides={})=>({enabled:true,supported:true,active:false,restConfirmed:false,restReason:'settling: still for 4 of 20 min',
 retainReason:'rest not confirmed: settling: still for 4 of 20 min',serviceSession:'held',keepAliveRunning:false,sessionReleases:0,
 lastPreciseReason:'none yet',modeSeconds:{standby:240},wifi:{connected:null},...overrides});
const row=(rows,label)=>rows.find(([name])=>name===label)?.[1];

describe('native bridge',()=>{
 beforeEach(()=>{native.setPassiveRest.mockReset();});
 it('sends the passive rest switch',async()=>{
  await recorder.setPassiveRest(false);
  expect(native.setPassiveRest).toHaveBeenCalledWith({enabled:false});
 });
 it('sends only the sharing device-test switch',async()=>{
  await recorder.setSharingRest(true);
  expect(native.setSharingRest).toHaveBeenCalledWith({enabled:true});
 });
});

describe('passive rest rows',()=>{
 it('are absent when the native build does not report passive rest',()=>expect(passiveRows({})).toEqual([]));
 it('explain why the background session is still held while settling',()=>{
  const rows=passiveRows({passiveRest:passive()});
  expect(row(rows,'Passive rest')).toBe('Not active · rest not confirmed: settling: still for 4 of 20 min');
  expect(row(rows,'Wi-Fi connection')).toBe('Not reported');
  expect(row(rows,'Always service session')).toBe('Held (started with the app open)');
 });
 it('report an active passive rest, Wi-Fi as a match state and the measured departure',()=>{
  const rows=passiveRows({passiveRest:passive({active:true,since:1000,restConfirmed:true,restReason:'at a saved place, still for 16 min, Wi-Fi connected',retainReason:null,
   sessionReleases:1,sessionReleasedAt:1000,modeSeconds:{passive:3600,precise:300},wifi:{connected:true,observedAt:1000,source:'background wake-up'}}),
   lastDepartureLatency:{engine:'passive',cause:'place region exit',evidenceToFirstFixSeconds:'9',motionOnsetToEvidenceSeconds:'140',startGapMeters:'180'}});
  expect(row(rows,'Confirmed rest (needed for passive rest)')).toBe('Confirmed · at a saved place, still for 16 min, Wi-Fi connected');
  expect(row(rows,'Passive rest')).toMatch(/^Active since .* no location updates, no background session$/);
  expect(row(rows,'Wi-Fi connection')).toBe('Connected');
  expect(row(rows,'Time per location mode (since app start)')).toBe('precise 5 min · passive 1 h');
  expect(row(rows,'Departure from rest')).toBe('woken by place region exit · movement began 140 s earlier · first GPS 9 s after waking · route began ~180 m beyond the place');
 });
 it('say whether live sharing holds location and why',()=>{
  const rows=passiveRows({passiveRest:passive({sharingRest:{enabled:false,allowed:false,reason:'keeps continuous location: releasing it while sharing is a device test that is off',sharingHoldsLocation:true},falseWakeRestoresThisHour:2})});
  expect(row(rows,'Sharing while resting')).toBe('Off · sharing keeps continuous location · keeps continuous location: releasing it while sharing is a device test that is off');
  expect(row(rows,'False wake-ups restored this hour')).toBe('2');
  expect(row(passiveRows({passiveRest:passive({sharingRest:{enabled:true,allowed:true,reason:'the shared position is the verified resting place',sharingHoldsLocation:false}})}),'Sharing while resting'))
   .toBe('Device test on · sharing does not hold location · the shared position is the verified resting place');
 });
 it('name reduced-accuracy rest apart from the confirmed rest passive rest needs',()=>{
  const rows=passiveRows({passiveRest:passive({restStage:'reducedAccuracy',reducedAccuracyRest:{active:true,insideSince:1000,place:'currentPlace',requiredSeconds:600}})});
  expect(row(rows,'Reduced-accuracy rest')).toBe('Active at the current place · 100 m location, background session kept');
  expect(row(rows,'Confirmed rest (needed for passive rest)')).toBe('settling: still for 4 of 20 min');
  expect(row(passiveRows({passiveRest:passive()}),'Reduced-accuracy rest')).toBe('Not reported');
 });
 it('say when a decision to rest with sharing is waiting to be decided again',()=>{
  const rows=passiveRows({passiveRest:passive({sharingRest:{enabled:true,allowed:true,reason:'the shared position is the verified resting place',sharingHoldsLocation:true,decisionCurrent:false}})});
  expect(row(rows,'Sharing while resting')).toBe('Device test on · sharing keeps continuous location · the shared position is the verified resting place · sharing changed since; deciding again');
 });
 it('report background recovery as armed or failing, never as working',()=>{
  expect(row(passiveRows({passiveRest:passive({backgroundRecovery:{status:'armed',issues:[],lastWakeOutcome:'none yet'}})}),'Background recovery'))
   .toBe('Wake-ups armed · not proof that a departure will be caught');
  expect(row(passiveRows({passiveRest:passive({backgroundRecovery:{status:'limited',issues:['serviceSessionMissing','keepAliveNotRunning'],lastWakeOutcome:'noPreciseFix'}})}),'Background recovery'))
   .toBe('Limited · no Always service session, so precise GPS after a wake-up cannot keep the app running · the keep-alive that lets iOS resume the app is not running · the last wake-up check ended without a precise fix');
  expect(row(passiveRows({passiveRest:passive({backgroundRecovery:{status:'notNeeded',issues:[],lastWakeOutcome:'preciseFix'}})}),'Background recovery'))
   .toBe('Not needed · the background location session is held · a precise fix followed the last wake-up');
  expect(row(passiveRows({passiveRest:passive()}),'Background recovery')).toBe('Not reported');
 });
 it('shows interrupted and unknown wake-up outcomes',()=>{
  for(const [outcome,label] of [['interrupted','the last wake-up check was interrupted before a precise fix'],['unknown','the last wake-up outcome is unknown; the check ended while the app was not running']]){
   expect(row(passiveRows({passiveRest:passive({backgroundRecovery:{status:'armed',issues:[],lastWakeOutcome:outcome}})}),'Background recovery')).toContain(label);
  }
 });
 it('treat unavailable Wi-Fi as unavailable, not as disconnected',()=>{
  expect(row(passiveRows({passiveRest:passive({wifi:{connected:false}})}),'Wi-Fi connection')).toBe('Unavailable');
 });
});

describe('Tracking & Permissions controls',()=>{
 it('offer the sharing device test off by default, only while passive rest is on',()=>{
  const run=vi.fn();
  const sharingRest={enabled:false,allowed:false,reason:'sharing is off',sharingHoldsLocation:false};
  const state={permission:'always',automaticEnabled:true,storageReady:true,places:[],passiveRest:passive({sharingRest})};
  const {rerender}=render(<TrackingPermissions recording={{state,run}} onBack={vi.fn()}/>);
  const toggle=screen.getByRole('switch',{name:'Release location while resting with sharing on'});
  expect(toggle).toHaveAttribute('aria-checked','false');
  fireEvent.click(toggle);
  expect(run).toHaveBeenCalledWith('setSharingRest',true);
  rerender(<TrackingPermissions recording={{state:{...state,passiveRest:passive({enabled:false,sharingRest})},run}} onBack={vi.fn()}/>);
  expect(screen.getByRole('switch',{name:'Release location while resting with sharing on'})).toBeDisabled();
 });
 it('uses Wi-Fi automatically and keeps the passive rest switch',()=>{
  const run=vi.fn();
  const state={permission:'always',automaticEnabled:true,storageReady:true,places:[],passiveRest:passive({wifi:{connected:true}})};
  render(<TrackingPermissions recording={{state,run}} onBack={vi.fn()}/>);
  fireEvent.click(screen.getByRole('switch',{name:'Release location while resting'}));
  expect(run).toHaveBeenCalledWith('setPassiveRest',false);
  expect(screen.queryByRole('button',{name:'Use current Wi-Fi'})).not.toBeInTheDocument();
  expect(screen.getByText('Wi-Fi connection').nextSibling).toHaveTextContent('Connected');
 });
 it('names passive rest as the native state',()=>{
  render(<TrackingPermissions recording={{state:{permission:'always',automaticEnabled:true,storageReady:true,automaticSampling:'passiveRest',passiveRest:passive({active:true})},run:vi.fn()}} onBack={vi.fn()}/>);
  expect(screen.getByText('Native state').nextSibling).toHaveTextContent('Resting · Passive (no location updates; wake-ups armed)');
 });
});
