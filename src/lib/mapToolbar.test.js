import {expect,it} from 'vitest';
import {activitySymbol,mapToolbar,toolbarChange} from './mapToolbar.js';
import {DEFAULT_MAP_VIEW,shiftMapDay} from './mapLayers.js';
it('uses distinct activity symbols and preserves unknown recorded types',()=>{
 const activities=['Driving','Walking','Cycling','MTB','Running','Hiking','Kitesurfing','Sailing'];
 expect(new Set(activities.map(activitySymbol)).size).toBe(8);
 const toolbar=mapToolbar({...DEFAULT_MAP_VIEW,routes:'all'},true,'activity',activities);
 expect(toolbar.rows.find(row=>row.id==='activity').options.map(option=>option.label)).toEqual(['All activities',...activities]);
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
 expect(toolbarChange(toolbarChange(day,'mode:trails'),'mode:routes')).toEqual(day);
});
it('makes the displayed calendar date the Today shortcut without a redundant sun button',()=>{
 const calendar=view=>mapToolbar(view,true,'calendar',[],'2026-10-30').rows.find(row=>row.id==='calendar').options;
 const options=calendar(DEFAULT_MAP_VIEW);
 expect(options.filter(option=>option.id==='day:2026-10-30')).toEqual([expect.objectContaining({label:'Today',text:'Today',symbol:'calendar'})]);
 expect(options.some(option=>option.symbol==='sun.max')).toBe(false);
 const past=calendar({...DEFAULT_MAP_VIEW,day:'2026-10-28'});
 expect(past.find(option=>option.label==='Return to Today')).toMatchObject({id:'day:2026-10-30'});
 expect(toolbarChange(DEFAULT_MAP_VIEW,options[1].id)).toMatchObject({day:'2026-10-30',routes:'all'});
});
