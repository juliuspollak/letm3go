import {describe,expect,it} from 'vitest';
import {activeCalories,activitySummary,durationText,elevationGainMeters,heartRateSummary,workoutEnergy} from './activitySummary.js';

describe('activity summary values',()=>{
 it('formats a duration in the largest useful unit',()=>{
  expect(durationText(5400)).toBe('1 h 30 min');
  expect(durationText(300)).toBe('5 min');
  expect(durationText(42)).toBe('42 s');
  expect(durationText(undefined)).toBe('0 s');
 });
 it('prefers a saved elevation gain but can derive one from the fixes',()=>{
  expect(elevationGainMeters({elevationGain:180})).toBe(180);
  const points=[{altitude:10},{altitude:25},{altitude:20},{altitude:35}];
  expect(elevationGainMeters({points})).toBe(30);
  expect(elevationGainMeters({points:[{altitude:10}]})).toBeNull();
  expect(elevationGainMeters({})).toBeNull();
 });
 it('does not turn altitude jitter, invalid fixes or pauses into climb',()=>{
  // A long ride whose barometer wanders one metre up and down must not accumulate
  // thousands of metres of gain.
  const jitter=Array.from({length:200},(_,index)=>({altitude:100+(index%2)}));
  expect(elevationGainMeters({points:jitter})).toBeNull();
  // Missing altitude is persisted as 0 by some recorders; that is not sea level.
  expect(elevationGainMeters({points:[{altitude:100},{altitude:0},{altitude:140}]})).toBeNull();
  expect(elevationGainMeters({points:[{altitude:100},{altitude:300,accuracy:80},{altitude:140}]})).toBe(40);
  // A pause or segment jump starts a new reference instead of joining two places.
  expect(elevationGainMeters({points:[{segment:0,altitude:100},{segment:0,altitude:130},{segment:1,altitude:500},{segment:1,altitude:540}]})).toBe(70);
  expect(elevationGainMeters({points:[{timestamp:0,altitude:100},{timestamp:1000,altitude:700},{timestamp:1001,altitude:740}]})).toBe(40);
 });
 it('never invents calories from an implausible value',()=>{
  expect(activeCalories({details:{activeEnergyKcal:412.4}})).toEqual({kcal:412,label:'Active calories',source:null});
  expect(activeCalories({details:{caloriesKcal:88}})).toEqual({kcal:88,label:'Calories',source:null});
  expect(activeCalories({details:{activeEnergyKcal:412.4},source:'watch'})).toEqual({kcal:412,label:'Active calories',source:null});
  expect(activeCalories({details:{activeCalories:0}})).toBeNull();
  expect(activeCalories({details:{activeCalories:999999}})).toBeNull();
  expect(activeCalories({})).toBeNull();
 });
 it('only attributes calories to Apple Watch when the recording source says watch',()=>{
  const generic=activitySummary({details:{caloriesKcal:300}}).find(entry=>entry.id==='calories');
  expect(generic).toMatchObject({label:'Calories',detail:null});
  const watch=activitySummary({source:'watch',details:{activeEnergyKcal:300,energySource:'healthkit'}}).find(entry=>entry.id==='calories');
  expect(watch).toMatchObject({label:'Active calories',detail:'From Apple Watch active energy'});
 });
 it('reports a heart rate only when an average was recorded',()=>{
  expect(heartRateSummary({details:{heartRate:{summary:{average:128.6,maximum:161.2}}}})).toEqual({average:129,maximum:161});
  expect(heartRateSummary({details:{heartRate:{summary:{average:128.6}}}})).toEqual({average:129,maximum:null});
  expect(heartRateSummary({details:{heartRate:{summary:{maximum:161}}}})).toBeNull();
 });
 it('orders the readout with distance then time and converts the unit once',()=>{
  const trip={distance:10,durationSeconds:3600,elevationGain:120};
  expect(activitySummary(trip).map(entry=>entry.id)).toEqual(['distance','elapsed','elevation']);
  expect(activitySummary(trip,{unit:'mi'})[0].value).toBe('6.2 mi');
 });
 it('labels elapsed time as such when a moving time is known',()=>{
  const entries=activitySummary({durationSeconds:3600,details:{movingSeconds:3000}});
  expect(entries.map(entry=>[entry.label,entry.value])).toEqual([['Moving time','50 min'],['Elapsed time','1 h 0 min']]);
 });
});

it('rejects untyped energy aliases and distinguishes measured zero from missing energy',()=>{
 expect(activeCalories({source:'watch',details:{activeEnergy:418400}})).toBeNull();
 expect(activeCalories({source:'watch',calories:100})).toBeNull();
 expect(activeCalories({source:'watch',details:{activeEnergyKcal:0,energySource:'healthkit'}})).toEqual({kcal:0,label:'Active calories',source:'watch'});
 expect(activeCalories({source:'watch',details:{caloriesKcal:100,energySource:'healthkit'}})).toEqual({kcal:100,label:'Calories',source:null});
});

const measured=(energy={})=>({source:'watch',details:{energy:{schema:1,unit:'kcal',source:'healthkit',state:'final',...energy}}});
it('renders active and total measured energy separately, preserving measured zero',()=>{
 const entries=activitySummary(measured({active:0,total:100}));
 expect(entries.find(e=>e.id==='calories')).toMatchObject({label:'Active calories',value:'0 kcal',detail:'From Apple Watch active energy'});
 expect(entries.find(e=>e.id==='total-calories')).toMatchObject({label:'Total calories',value:'100 kcal',detail:'Active + resting energy'});
});
it.each([['kcal',100],['J',418400],['kJ',418.4]])('converts explicit %s energy to kcal without using HR', (unit,active)=>{
 expect(activeCalories(measured({unit,active}))).toEqual({kcal:100,label:'Active calories',source:'watch'});
});
it('rejects malformed units, nonfinite readings, negative and inconsistent totals',()=>{
 for(const unit of ['cal','joules','toString',''])expect(workoutEnergy(measured({unit,active:100}))).toBeNull();
 for(const active of [NaN,Infinity,-1,'100',null])expect(activeCalories(measured({active}))).toBeNull();
 expect(workoutEnergy(measured({active:100,total:50}))).toMatchObject({activeKcal:100,totalKcal:null});
 expect(workoutEnergy(measured({schema:2,active:100}))).toBeNull();
});
it('distinguishes pending finalization and unavailable energy without alleging permission denial',()=>{
 const pending=activitySummary(measured({active:80,state:'pending'}));
 expect(pending.find(e=>e.id==='calories').detail).toBe('Awaiting workout finalization');
 expect(activitySummary(measured({state:'pending'})).find(e=>e.id==='energy-state').value).toBe('Pending');
 const missing=activitySummary(measured({state:'unavailable',active:999}));
 expect(missing.find(e=>e.id==='calories')).toBeUndefined();
 expect(missing.find(e=>e.id==='energy-state')).toMatchObject({value:'Unavailable',detail:'No readable measured active energy was saved'});
 expect(activitySummary(measured()).find(e=>e.id==='energy-state').value).toBe('Unavailable');
});
it('never renders quarantined body data or falls back from an explicitly unavailable contract',()=>{
 const held={source:'watch',details:{unverifiedEnergy:measured({active:400}).details.energy}};
 expect(activeCalories(held)).toBeNull();expect(activitySummary(held)).toEqual([]);
 const unavailable=measured({state:'unavailable'});unavailable.details.activeEnergyKcal=999;
 expect(activeCalories(unavailable)).toBeNull();
 const original=measured({unit:'J',active:418400});const before=JSON.stringify(original);
 expect(activeCalories(original).kcal).toBe(100);expect(JSON.stringify(original)).toBe(before);
});
