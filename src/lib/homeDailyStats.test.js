import {describe,expect,it} from 'vitest';
import {dailyJourneyTotals,homeJourneysForDay} from './homeDailyStats.js';

const today='2026-11-05';
const at=(day,time)=>new Date(`${day}T${time}:00`).getTime()/1000;
const trip=(id,day,from,to,distanceMeters=1000)=>({
 id,date:day,startedAt:at(day,from),endedAt:at(day,to),
 durationSeconds:(at(day,to)-at(day,from)),distanceMeters
});

describe('Home day selection',()=>{
 it('excludes archived and household activities exactly as the default Activities view does',()=>{
  const local=trip('own',today,'10:00','11:00');
  const archived=trip('hidden',today,'12:00','13:00');
  const household={...trip('shared',today,'14:00','15:00'),readOnly:true};
  const selected=homeJourneysForDay([local,archived,household],['hidden'],'today',today);
  expect(selected).toEqual([local]);
  expect(dailyJourneyTotals(selected,'today',today)).toEqual({count:1,distanceMeters:1000,durationSeconds:3600});
 });
 it('keeps a grouped journey on the days with recorded segments but not during a gap',()=>{
  const grouped={id:'group',segments:[
   trip('first','2026-11-02','10:00','11:00',2000),
   trip('second','2026-11-04','10:00','11:00',3000)
  ]};
  expect(homeJourneysForDay([grouped],[],'2026-11-03',today)).toEqual([]);
  expect(dailyJourneyTotals(homeJourneysForDay([grouped],[],'2026-11-02',today),'2026-11-02',today)).toEqual({count:1,distanceMeters:2000,durationSeconds:3600});
  expect(dailyJourneyTotals(homeJourneysForDay([grouped],[],'2026-11-04',today),'2026-11-04',today)).toEqual({count:1,distanceMeters:3000,durationSeconds:3600});
 });
});

describe('Daily recorded totals',()=>{
 it('allocates a midnight-crossing journey to each actual local day without double counting',()=>{
  const start=at('2026-11-03','23:30');
  const end=at('2026-11-04','00:30');
  const journey={id:'overnight',date:'2026-11-03',startedAt:start,endedAt:end,distanceMeters:1000,durationSeconds:3600};
  const first=dailyJourneyTotals([journey],'2026-11-03',today);
  const second=dailyJourneyTotals([journey],'2026-11-04',today);
  expect(first).toEqual({count:1,distanceMeters:500,durationSeconds:1800});
  expect(second).toEqual({count:1,distanceMeters:500,durationSeconds:1800});
  expect(first.distanceMeters+second.distanceMeters).toBe(1000);
  expect(first.durationSeconds+second.durationSeconds).toBe(3600);
 });
 it('scales recorded duration rather than elapsed clock time when there are pauses',()=>{
  const journey={id:'paused',date:'2026-11-03',startedAt:at('2026-11-03','23:30'),endedAt:at('2026-11-04','00:30'),distanceMeters:4000,durationSeconds:1200};
  expect(dailyJourneyTotals([journey],'2026-11-03',today)).toEqual({count:1,distanceMeters:2000,durationSeconds:600});
 });
 it('uses segments instead of elapsed time across a merged journey with a long gap',()=>{
  const journey={id:'merged',date:'2026-11-03',startedAt:at('2026-11-03','12:00'),endedAt:at('2026-11-05','12:00'),distanceMeters:9000,durationSeconds:7200,segments:[
   {...trip('a','2026-11-03','12:00','13:00',4000)},
   {...trip('b','2026-11-05','11:00','12:00',5000)}
  ]};
  expect(dailyJourneyTotals([journey],'2026-11-04',today)).toEqual({count:1,distanceMeters:0,durationSeconds:0});
  expect(dailyJourneyTotals([journey],'2026-11-05',today)).toEqual({count:1,distanceMeters:5000,durationSeconds:3600});
 });
 it('assigns legacy data with missing end time only to its known day',()=>{
  const journey={id:'legacy',date:'2026-11-03',startedAt:at('2026-11-03','23:45'),distanceMeters:700,durationSeconds:900};
  expect(dailyJourneyTotals([journey],'2026-11-03',today)).toEqual({count:1,distanceMeters:700,durationSeconds:900});
  expect(dailyJourneyTotals([journey],'2026-11-04',today)).toEqual({count:1,distanceMeters:0,durationSeconds:0});
 });
});
