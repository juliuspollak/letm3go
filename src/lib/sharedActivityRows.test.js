import {expect,it} from 'vitest';
import {filterActivityScope,sharedActivityRow} from './sharedActivityRows.js';
const feed={activity_id:'abc',owner_id:'person',title:'Walk',activity:'Walking',started_at:'2026-11-07T02:00:00Z',ended_at:'2026-11-07T02:30:00Z',duration_seconds:1800,distance_km:2.5};
it('turns only safe feed metadata into read-only Activities rows',()=>{
 const row=sharedActivityRow(feed,'Julia');
 expect(row).toMatchObject({id:'shared:abc',sharedActivityID:'abc',isShared:true,readOnly:true,source:'shared',ownerName:'Julia',distanceMeters:2500,durationSeconds:1800,tags:[],route:[],photos:[]});
 expect(row.startedAt).toBe(Date.parse(feed.started_at)/1000);
});
it('excludes shared rows when toggle is off and combines them when enabled',()=>{
 const mine=[{id:'mine'}],shared=[sharedActivityRow(feed)];
 expect(filterActivityScope(mine,shared,false)).toEqual(mine);
 expect(filterActivityScope(mine,shared,true)).toEqual([...mine,...shared]);
});
it('rejects malformed feed rows',()=>expect(sharedActivityRow({activity_id:'bad'})).toBeNull());
