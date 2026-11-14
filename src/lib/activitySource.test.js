import {expect,it} from 'vitest';
import {activitySource,activitySourceCounts,matchesActivitySource} from './activitySource.js';
const auto={id:'a',recordingMode:'automatic'},manual={id:'m',recordingMode:'manual'},watch={id:'w',recordingMode:'watch'},shared={id:'s',isShared:true};
it('falls back to All for anything unknown',()=>{
 expect(activitySource('automatic')).toBe('automatic');
 expect(activitySource('manual')).toBe('manual');
 expect(activitySource('bogus')).toBe('all');
 expect(activitySource(undefined)).toBe('all');
});
it('filters own activities by how they were recorded and never hides shared rows',()=>{
 const rows=[auto,manual,watch,shared];
 expect(rows.filter(t=>matchesActivitySource(t,'all'))).toEqual(rows);
 expect(rows.filter(t=>matchesActivitySource(t,'automatic'))).toEqual([auto,shared]);
 expect(rows.filter(t=>matchesActivitySource(t,'manual'))).toEqual([manual,watch,shared]);
});
it('counts only own activities',()=>{
 expect(activitySourceCounts([auto,manual,watch,shared])).toEqual({all:3,automatic:1,manual:2});
 expect(activitySourceCounts(undefined)).toEqual({all:0,automatic:0,manual:0});
});
