import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({currentPosition:vi.fn(),setPassiveRest:vi.fn(),setSharingRest:vi.fn(),setHomeWiFi:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=>'ios'},registerPlugin:()=>native}));
import {recorder} from './recorder.js';
import {passiveRows} from './passiveRestDiagnostics.js';
import TrackingPermissions from '../components/TrackingPermissions.jsx';

afterEach(cleanup);
const home={id:'h',name:'Home',kind:'home',latitude:-33.8,longitude:151.2,radius:120};
const passive=(overrides={})=>({enabled:true,supported:true,active:false,restConfirmed:false,restReason:'settling: still for 4 of 20 min',
 retainReason:'rest not confirmed: settling: still for 4 of 20 min',serviceSession:'held',keepAliveRunning:false,sessionReleases:0,
 lastPreciseReason:'none yet',modeSeconds:{standby:240},wifi:{configured:false,match:'notConfigured'},...overrides});
const row=(rows,label)=>rows.find(([name])=>name===label)?.[1];

describe('native bridge',()=>{
 beforeEach(()=>{native.setPassiveRest.mockReset();native.setHomeWiFi.mockReset();});
 it('sends only the switch and the Wi-Fi action, never a network name',async()=>{
  await recorder.setPassiveRest(false);
  await recorder.setHomeWiFi('designate');
  await recorder.setHomeWiFi('forget');
  expect(native.setPassiveRest).toHaveBeenCalledWith({enabled:false});
  expect(native.setHomeWiFi.mock.calls).toEqual([[{action:'designate'}],[{action:'forget'}]]);
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
  expect(row(rows,'Home Wi-Fi')).toBe('Not configured');
  expect(row(rows,'Always service session')).toBe('Held (started with the app open)');
 });
 it('report an active passive rest, Wi-Fi as a match state and the measured departure',()=>{
  const rows=passiveRows({passiveRest:passive({active:true,since:1000,restConfirmed:true,restReason:'at Home, still for 16 min, Home Wi-Fi connected',retainReason:null,
   sessionReleases:1,sessionReleasedAt:1000,modeSeconds:{passive:3600,precise:300},wifi:{configured:true,match:'matched',observedAt:1000,source:'background wake-up'}}),
   adaptive:{lastDepartureLatency:{engine:'passive',cause:'place region exit',evidenceToFirstFixSeconds:'9',motionOnsetToEvidenceSeconds:'140',startGapMeters:'180'}}});
  expect(row(rows,'Confirmed rest (needed for passive rest)')).toBe('Confirmed · at Home, still for 16 min, Home Wi-Fi connected');
  expect(row(rows,'Passive rest')).toMatch(/^Active since .* no location updates, no background session$/);
  expect(row(rows,'Home Wi-Fi')).toBe('Home Wi-Fi detected');
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
 it('treat unavailable Wi-Fi as unavailable, not as disconnected',()=>{
  expect(row(passiveRows({passiveRest:passive({wifi:{configured:true,match:'unavailable'}})}),'Home Wi-Fi')).toBe('Wi-Fi unavailable');
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
 it('switch passive rest and designate Home Wi-Fi only once Home is saved',()=>{
  const run=vi.fn();
  const state={permission:'always',automaticEnabled:true,storageReady:true,places:[],passiveRest:passive()};
  const {rerender}=render(<TrackingPermissions recording={{state,run}} onBack={vi.fn()}/>);
  const toggle=screen.getByRole('switch',{name:'Release location while resting'});
  expect(toggle).toHaveAttribute('aria-checked','true');
  fireEvent.click(toggle);
  expect(run).toHaveBeenCalledWith('setPassiveRest',false);
  expect(screen.getByRole('button',{name:'Use current Wi-Fi'})).toBeDisabled();
  rerender(<TrackingPermissions recording={{state:{...state,places:[home]},run}} onBack={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Use current Wi-Fi'}));
  expect(run).toHaveBeenCalledWith('setHomeWiFi','designate');
  rerender(<TrackingPermissions recording={{state:{...state,places:[home],passiveRest:passive({wifi:{configured:true,match:'matched'}})},run}} onBack={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Forget'}));
  expect(run).toHaveBeenCalledWith('setHomeWiFi','forget');
 });
 it('names every Home Wi-Fi state in plain words',()=>{
  const labels=['matched','notMatched','unavailable','unknown'].map(match=>row(passiveRows({passiveRest:passive({wifi:{configured:true,match}})}),'Home Wi-Fi'));
  expect(labels).toEqual(['Home Wi-Fi detected','Connected to another network','Wi-Fi unavailable','Waiting for fresh Wi-Fi evidence']);
 });
 it('shows a failed Home Wi-Fi setup beside the control and offers another try',async()=>{
  const run=vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({trips:[]});
  const state={permission:'always',automaticEnabled:true,storageReady:true,places:[home],passiveRest:passive()};
  const message='iOS did not report a Wi-Fi network. Connect to your Home Wi-Fi, keep Precise Location on, and try again.';
  render(<TrackingPermissions recording={{state,run,error:message}} onBack={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Use current Wi-Fi'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('did not report a Wi-Fi network');
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  expect(run).toHaveBeenCalledTimes(2);
  await screen.findByRole('button',{name:'Use current Wi-Fi'});
  expect(screen.getAllByRole('alert')).toHaveLength(1);
 });
 it('says when a saved Home Wi-Fi could not be read rather than that it was never set',()=>{
  render(<TrackingPermissions recording={{state:{permission:'always',storageReady:true,places:[home],passiveRest:passive({wifi:{configured:false,status:'unreadable',match:'notConfigured'}})},run:vi.fn()}} onBack={vi.fn()}/>);
  expect(screen.getByText(/could not be read on this iPhone/)).toBeInTheDocument();
 });
 it('names passive rest as the native state',()=>{
  render(<TrackingPermissions recording={{state:{permission:'always',automaticEnabled:true,storageReady:true,automaticSampling:'passiveRest',passiveRest:passive({active:true})},run:vi.fn()}} onBack={vi.fn()}/>);
  expect(screen.getByText('Native state').nextSibling).toHaveTextContent('Resting · Passive (no location updates; wake-ups armed)');
 });
});
