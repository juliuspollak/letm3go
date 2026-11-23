import {describe,expect,it} from 'vitest';
import {EXPERIMENT_MODES,OBSERVATIONS,UNLOCK_TAPS,UNLOCK_WINDOW_MS,experimentRows,nextUnlockTap} from './locationExperiment.js';

describe('the developer unlock',()=>{
 it('needs seven quick taps, and resets after a pause',()=>{
  let state={count:0,first:NaN},unlocked=false;
  for(let tap=0;tap<UNLOCK_TAPS-1;tap++){const r=nextUnlockTap(state,1000+tap*100);state=r.state;unlocked=unlocked||r.unlock;}
  expect(unlocked).toBe(false);
  const done=nextUnlockTap(state,1000+(UNLOCK_TAPS-1)*100);
  expect(done.unlock).toBe(true);
  expect(done.state.count).toBe(0);
  const slow=nextUnlockTap({count:UNLOCK_TAPS-1,first:0},UNLOCK_WINDOW_MS+1);
  expect(slow.unlock).toBe(false);
  expect(slow.state.count).toBe(1);
 });
 it('starts from nothing',()=>{
  expect(nextUnlockTap(undefined,5)).toEqual({state:{count:1,first:5},unlock:false});
 });
});

describe('the experiment rows',()=>{
 const experiment={mode:'b',label:'Mode B · no activity session, keep-alive kept',sessionOwnership:'none',keepAliveRunning:true,runningAPIs:'standard(precise),keepAlive.liveUpdates',
  predicted:{pill:'untested',arrow:true,basis:'Always access with a liveUpdates stream and no session'},confounders:'lowPowerMode',expiresAt:2000000000,
  observations:[{at:1900000000,observed:'none',predictedPill:'untested',agreement:'untested',arrowAgreement:'disagrees',mode:'b'}]};
 const rows=Object.fromEntries(experimentRows(experiment));
 it('keeps the app prediction and a person\'s observation under different names',()=>{
  expect(Object.keys(rows)).toContain('Predicted by the app (not an observation)');
  expect(Object.keys(rows)).toContain('Last physical observation (a person)');
  expect(rows['Predicted by the app (not an observation)']).toMatch(/untested/);
  expect(rows['Last physical observation (a person)']).toMatch(/nothing visible.*Mode B.*prediction was untested.*arrow not as predicted/);
 });
 it('says plainly what is running, and what could confound a comparison',()=>{
  expect(rows['Activity session']).toBe('Not held');
  expect(rows['Keep-alive']).toBe('Running');
  expect(rows['Location APIs running']).toContain('keepAlive.liveUpdates');
  expect(rows['Comparison confounders']).toBe('lowPowerMode');
 });
 it('reports no observation when nobody has recorded one',()=>{
  expect(Object.fromEntries(experimentRows({...experiment,observations:[]}))['Last physical observation (a person)']).toBe('None recorded');
  expect(experimentRows(undefined)).toEqual([]);
 });
 it('offers exactly the three modes and three observations',()=>{
  expect(EXPERIMENT_MODES.map(item=>item.mode)).toEqual(['a','b','c']);
  expect(OBSERVATIONS.map(item=>item.value)).toEqual(['pill','arrow','none']);
 });
});
