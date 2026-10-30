import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({currentPosition:vi.fn(),setPassiveRest:vi.fn(),setHomeWiFi:vi.fn()}));
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
});

describe('passive rest rows',()=>{
 it('are absent when the native build does not report passive rest',()=>expect(passiveRows({})).toEqual([]));
 it('explain why the background session is still held while settling',()=>{
  const rows=passiveRows({passiveRest:passive()});
  expect(row(rows,'Passive rest')).toBe('Not active · rest not confirmed: settling: still for 4 of 20 min');
  expect(row(rows,'Home Wi-Fi')).toBe('Not set up');
  expect(row(rows,'Always service session')).toBe('Held (started with the app open)');
 });
 it('report an active passive rest, Wi-Fi as a match state and the measured departure',()=>{
  const rows=passiveRows({passiveRest:passive({active:true,since:1000,restConfirmed:true,restReason:'at Home, still for 16 min, Home Wi-Fi connected',retainReason:null,
   sessionReleases:1,sessionReleasedAt:1000,modeSeconds:{passive:3600,precise:300},wifi:{configured:true,match:'matched',observedAt:1000,source:'background wake-up'}}),
   adaptive:{lastDepartureLatency:{engine:'passive',cause:'place region exit',evidenceToFirstFixSeconds:'9',motionOnsetToEvidenceSeconds:'140',startGapMeters:'180'}}});
  expect(row(rows,'Rest')).toBe('Confirmed · at Home, still for 16 min, Home Wi-Fi connected');
  expect(row(rows,'Passive rest')).toMatch(/^Active since .* no location updates, no background session$/);
  expect(row(rows,'Home Wi-Fi')).toBe('Connected to Home Wi-Fi');
  expect(row(rows,'Time per location mode (since app start)')).toBe('precise 5 min · passive 1 h');
  expect(row(rows,'Departure from rest')).toBe('woken by place region exit · movement began 140 s earlier · first GPS 9 s after waking · route began ~180 m beyond the place');
 });
 it('treat unavailable Wi-Fi as unavailable, not as disconnected',()=>{
  expect(row(passiveRows({passiveRest:passive({wifi:{configured:true,match:'unavailable'}})}),'Home Wi-Fi')).toMatch(/^Unavailable/);
 });
});

describe('Tracking & Permissions controls',()=>{
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
 it('names passive rest as the native state',()=>{
  render(<TrackingPermissions recording={{state:{permission:'always',automaticEnabled:true,storageReady:true,automaticSampling:'passiveRest',passiveRest:passive({active:true})},run:vi.fn()}} onBack={vi.fn()}/>);
  expect(screen.getByText('Native state').nextSibling).toHaveTextContent('Resting · Passive (no location updates; wake-ups armed)');
 });
});
