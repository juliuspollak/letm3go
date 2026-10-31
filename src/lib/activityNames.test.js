import {expect,it} from 'vitest';
import {activityCode,activityLabel,activityOptions,sameActivity} from './activityNames.js';
import {activityChoices,DEFAULT_MAP_VIEW,mapViewJourneys,normaliseMapView} from './mapLayers.js';
import {mapToolbar,activitySymbol} from './mapToolbar.js';
import {activityTitle,contextualJourneyTitle} from './activityTitle.js';
import {categoriesForActivity} from './collection.js';
import {isTrailActivity} from './mtbLink.js';
it('has one visible name and stable code for every existing mountain biking spelling',()=>{
 for(const alias of ['MTB','mtb','Mountain biking','Mountain Biking',' Mountain Biking ']){
  expect(activityCode(alias)).toBe('MTB');expect(activityLabel(alias)).toBe('Mountain biking');expect(sameActivity(alias,'MTB')).toBe(true);
  expect(activitySymbol(alias)).toBe('mountain.2');expect(isTrailActivity({activity:alias})).toBe(true);
  expect(categoriesForActivity(alias).map(c=>c.id)).toEqual(['bicycle','ebike']);
 }
 expect(activityOptions(['MTB','Walking','Mountain Biking','Mountain biking'])).toEqual(['MTB','Walking']);
 expect(activityLabel('BMX')).toBe('BMX');expect(activityLabel(undefined)).toBeUndefined();
});
it('deduplicates map choices and matches old recordings and saved filters in either direction',()=>{
 const trips=[{id:'old',activity:'MTB'},{id:'name',activity:'Mountain biking'},{id:'capital',activity:'Mountain Biking'},{id:'walk',activity:'Walking'}];
 expect(activityChoices(trips)).toEqual(['MTB','Walking']);
 for(const activity of ['MTB','Mountain biking','Mountain Biking'])expect(mapViewJourneys(trips,{...DEFAULT_MAP_VIEW,routes:'all',activity},'2026-10-31').map(t=>t.id)).toEqual(['old','name','capital']);
 const view=normaliseMapView({routes:'all',activity:'Mountain Biking'});
 expect(view.activity).toBe('MTB');
 const options=mapToolbar(view,true,'activity',trips.map(t=>t.activity)).rows.find(r=>r.id==='activity').options;
 expect(options.filter(o=>o.label==='Mountain biking')).toHaveLength(1);
 expect(options.find(o=>o.label==='Mountain biking').selected).toBe(true);
 expect(options.some(o=>o.label==='MTB')).toBe(false);
});
it('renames generated labels without rewriting personal titles or source data',()=>{
 const trip={recordingMode:'automatic',activity:'MTB',title:'Automatically detected journey'};
 const before=JSON.stringify(trip);
 expect(activityTitle(trip)).toBe('Mountain biking');expect(JSON.stringify(trip)).toBe(before);
 expect(activityTitle({activity:'MTB',title:'MTB · 31 Oct 2026, 10:00'})).toBe('Mountain biking · 31 Oct 2026, 10:00');
 expect(activityTitle({activity:'MTB',title:'My MTB weekend'})).toBe('My MTB weekend');
 expect(contextualJourneyTitle('MTB',null,{name:'Forest'})).toBe('Mountain biking around Forest');
});
