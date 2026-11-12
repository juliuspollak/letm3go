import {expect,it} from 'vitest';
import {activitySymbol,mapControls,panelChange,toolbarChange} from './mapToolbar.js';
import {DEFAULT_MAP_VIEW,shiftMapDay} from './mapLayers.js';
it('uses distinct activity symbols and preserves unknown recorded types',()=>{
 const activities=['Driving','Walking','Cycling','MTB','Running','Hiking','Kitesurfing','Sailing'];
 expect(new Set(activities.map(activitySymbol)).size).toBe(8);
 const controls=mapControls({...DEFAULT_MAP_VIEW,routes:'all'},'filters',activities);
 expect(controls.panel.sections.find(section=>section.id==='activity').options.map(option=>option.label)).toEqual(['All activities',...activities.map(a=>a==='MTB'?'Mountain biking':a)]);
});
it('navigates calendar dates across month and year boundaries',()=>{
 expect(shiftMapDay('2026-01-01',-1)).toBe('2025-12-31');
 expect(shiftMapDay('2028-03-01',-1)).toBe('2028-02-29');
 expect(shiftMapDay('2026-10-04',1)).toBe('2026-10-05');
});
it('keeps rolling preferences and favourites while selecting days, and ignores day for Today layer',()=>{
 const original={...DEFAULT_MAP_VIEW,routes:'pinned',range:'365d',activity:'Walking'};
 const day=toolbarChange(original,'day:2026-10-01');
 expect(day).toEqual({...original,day:'2026-10-01'});
 expect(toolbarChange(day,'range:365d')).toEqual(original);
 expect(toolbarChange({...original,routes:'today'},'day:2026-10-01').routes).toBe('all');
 expect(toolbarChange({...original,routes:null},'day:2026-10-01').routes).toBe('all');
 // The Segments layer is drawn on the same map and changes nothing else.
 expect(toolbarChange(toolbarChange(day,'segments'),'segments')).toEqual(day);
 expect(toolbarChange(day,'segments')).toEqual({...day,segments:true});
});
const controls=(view,panel=null,archived=0)=>mapControls({...DEFAULT_MAP_VIEW,routes:null,...view},panel,[],'2026-10-30',archived);
it('offers a date bar only while routes are limited to one day',()=>{
 expect(controls({}).date).toBeNull();
 expect(controls({routes:'all'}).date).toBeNull();
 expect(controls({routes:'all',range:'7d'}).date).toBeNull();
 expect(controls({routes:'today'}).date).toMatchObject({label:'Today',today:null,clear:null,next:{disabled:true}});
 expect(controls({routes:'pinned',day:'2026-10-28'}).date).toMatchObject({today:{id:'day:2026-10-30'},clear:{id:'day:clear'},previous:{id:'day:2026-10-27'},next:{id:'day:2026-10-29'}});
 // A day the current view ignores must not look applied.
 expect(controls({routes:null,day:'2026-10-28'}).date).toBeNull();
 expect(controls({segments:true,routes:'pinned',day:'2026-10-28'}).date).toMatchObject({clear:{id:'day:clear'}});
 // A panel covers the same space; the bar returns when it closes.
 expect(controls({routes:'today'},'filters').date).toBeNull();
});
it('stays in Favourites while stepping days, and clearing the day resumes the saved range',()=>{
 const view={...DEFAULT_MAP_VIEW,routes:'pinned',range:'30d',day:'2026-10-28'};
 const previous=toolbarChange(view,controls(view).date.previous.id);
 expect(previous).toEqual({...view,day:'2026-10-27'});
 expect(toolbarChange(previous,'day:clear')).toEqual({...view,day:null});
});
it('counts only filters that change the map, and treats layers separately',()=>{
 expect(controls({}).active).toBe(0);
 expect(controls({style:'satellite'})).toMatchObject({active:0,layers:{changed:true}});
 expect(controls({range:'7d',activity:'Walking'}).active).toBe(0);
 expect(controls({routes:'today',range:'7d'}).active).toBe(1);
 expect(controls({routes:'all',archived:false},null,0).active).toBe(1);
 expect(controls({routes:'all',archived:false},null,2).active).toBe(2);
 // Segments is a layer, not a filter: it marks Layers as changed and keeps Filters.
 expect(controls({segments:true})).toMatchObject({active:0,filters:{id:'panel:filters'},layers:{changed:true,label:'Map layers: Segments'}});
 expect(controls({segments:true,style:'satellite'}).layers.label).toBe('Map layers: Satellite, Segments');
});
it('only opens what was asked, and Layers offers Segments and Friends\' journeys',()=>{
 const layers=controls({},'layers').panel;
 expect(layers.id).toBe('layers');
 expect(layers.sections.find(s=>s.id==='community').options).toEqual([expect.objectContaining({id:'segments',label:'Segments',selected:false}),expect.objectContaining({id:'social',label:'Friends’ journeys',selected:false})]);
 expect(mapControls({},'layers',[],'2026-11-10',0,true).panel.sections.find(s=>s.id==='community').options.find(o=>o.id==='social').selected).toBe(true);
 // The friends' layer is a view of other people, not a saved filter: toggling it does not change the saved Map settings.
 expect(toolbarChange({routes:null},'social')).toEqual({routes:null});
 expect(layers.sections.some(s=>s.id==='mode')).toBe(false);
 expect(panelChange(null,'panel:filters')).toBe('filters');
 expect(panelChange('filters','panel:layers')).toBe('layers');
 expect(panelChange('layers','panel:layers')).toBeNull();
 expect(panelChange('layers','panel:close')).toBeNull();
});
it('labels every panel option, and has no two Today choices',()=>{
 const panel=controls({routes:'all'},'filters').panel;
 const options=panel.sections.flatMap(section=>section.options);
 expect(options.every(option=>option.text)).toBe(true);
 expect(options.filter(option=>option.text==='Today')).toHaveLength(1);
 expect(new Set(options.map(option=>option.id)).size).toBe(options.length);
});
it('resets filters without touching how the map is drawn',()=>{
 const view={...DEFAULT_MAP_VIEW,style:'satellite',people:false,routes:'all',activity:'Walking',range:'7d',day:'2026-10-28',archived:false};
 expect(toolbarChange(view,'reset')).toEqual({...DEFAULT_MAP_VIEW,style:'satellite'});
});
