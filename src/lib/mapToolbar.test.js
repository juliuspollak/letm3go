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
