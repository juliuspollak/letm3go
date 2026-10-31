import {expect,it,vi} from 'vitest';
import {activeFilterCount,activityToolbar,canShiftForward,chosenDay,dateLabel,matchesDate,openDatePicker,shiftDate} from './activityFilters.js';
const today='2026-10-30';
const none={activity:'All activities',date:'all',favourites:false,archived:false,equipment:''};
const toolbar=over=>activityToolbar({...none,open:true,category:null,activities:['All activities','MTB'],archivedCount:0,sort:'newest',equipmentOptions:[],today,...over});
const local=(day,hour)=>new Date(`${day}T${hour}:00:00`).getTime()/1000;
it('moves from any selection by whole days and stops at today',()=>{
 expect(shiftDate('all',-1,today)).toBe('2026-10-29');
 expect(shiftDate('7d',-1,today)).toBe('2026-10-29');
 expect(shiftDate('2026-10-29',1,today)).toBe('today');
 expect(shiftDate('2026-03-01',-1,today)).toBe('2026-02-28');
 expect(canShiftForward('all',today)).toBe(false);
 expect(canShiftForward('7d',today)).toBe(false);
 expect(canShiftForward('today',today)).toBe(false);
 expect(canShiftForward('2026-10-29',today)).toBe(true);
});
it('keeps Today current after midnight',()=>{
 expect(chosenDay('today','2026-10-31')).toBe('2026-10-31');
 expect(matchesDate({date:today,startedAt:local(today,'12'),endedAt:local(today,'13')},'today','2026-10-31')).toBe(false);
});
it('matches each observed segment, not the gap between them',()=>{
 const grouped={date:'2026-10-20',segments:[{date:'2026-10-20',startedAt:local('2026-10-20','10'),endedAt:local('2026-10-20','11')},{date:'2026-10-22',startedAt:local('2026-10-22','10'),endedAt:local('2026-10-22','11')}]};
 expect(matchesDate(grouped,'2026-10-20',today)).toBe(true);
 expect(matchesDate(grouped,'2026-10-21',today)).toBe(false);
 expect(matchesDate(grouped,'2026-10-22',today)).toBe(true);
});
it('reads a rolling range the way the Map does',()=>{
 const now=local(today,'12')*1000;
 expect(matchesDate({endedAt:now/1000-6*86400},'7d',today,now)).toBe(true);
 expect(matchesDate({endedAt:now/1000-8*86400},'7d',today,now)).toBe(false);
});
it('names every kind of selection',()=>{
 expect(['all','today','2026-10-29','7d','2026-01-05'].map(date=>dateLabel(date,today))).toEqual(['All dates','Today','Yesterday','Past 7 days','5 Jan 2026']);
});
it('counts filters that hide activities, not the sort order',()=>{
 expect(activeFilterCount(none)).toBe(0);
 expect(activeFilterCount({activity:'MTB',date:'7d',favourites:true,archived:true,equipment:'x'})).toBe(5);
});
it('offers Archived only when there is an archive to view or leave, and Reset only when useful',()=>{
 const ids=over=>toolbar(over).rows.map(row=>row.id);
 expect(ids({})).toEqual(['date','activity','favourites','sort']);
 expect(ids({archivedCount:2})).toContain('archived');
 expect(ids({archived:true})).toContain('archived');
 expect(ids({equipmentOptions:[{id:'1',name:'Trek',count:2}]})).toContain('equipment');
 expect(ids({favourites:true})).toContain('reset');
});
it('marks the selected date whichever control chose it',()=>{
 const selected=date=>toolbar({date}).rows[0].options.filter(option=>option.selected).map(option=>option.label);
 expect(selected('all')).toEqual(['All dates']);
 expect(selected('today')).toEqual(['Today']);
 expect(selected('2026-10-29')).toEqual(['Yesterday']);
 expect(selected('30d')).toEqual(['Past 30 days']);
 expect(selected('2026-01-05')).toEqual([]);
});
it('falls back to focus where showPicker is missing or refused',()=>{
 const focus=vi.fn();
 openDatePicker({focus});
 openDatePicker({focus,showPicker(){throw new Error('NotAllowedError');}});
 expect(focus).toHaveBeenCalledTimes(2);
 const showPicker=vi.fn();
 openDatePicker({focus,showPicker});
 expect(showPicker).toHaveBeenCalledOnce();
 expect(focus).toHaveBeenCalledTimes(2);
});
it('shows the stored MTB code under its one display name',()=>{
 const [,chip]=toolbar({activity:'MTB'}).rows[1].options;
 expect(chip).toMatchObject({id:'activity:MTB',label:'Mountain biking',selected:true});
});
