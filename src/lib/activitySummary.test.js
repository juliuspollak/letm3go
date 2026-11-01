import {describe,expect,it} from 'vitest';
import {activeCalories,activitySummary,durationText,elevationGainMeters,heartRateSummary} from './activitySummary.js';

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
 it('never invents calories from an implausible value',()=>{
  expect(activeCalories({details:{activeCalories:412.4}})).toEqual({kcal:412,label:'Active calories'});
  expect(activeCalories({details:{caloriesKcal:88}})).toEqual({kcal:88,label:'Calories'});
  expect(activeCalories({details:{activeCalories:0}})).toBeNull();
  expect(activeCalories({details:{activeCalories:999999}})).toBeNull();
  expect(activeCalories({})).toBeNull();
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
