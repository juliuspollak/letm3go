import {expect,it} from 'vitest';
import {mergeGroupingActivities} from './mergeGroupingActivities.js';

const row=(id,extra={})=>({id,owner_id:'o',title:'Walking',activity:'Walking',recording_mode:'automatic',started_at:'2026-11-11T07:42:04Z',ended_at:'2026-11-11T07:50:04Z',duration_seconds:480,distance_meters:500,route_points:[],point_count:0,revision:1,...extra});
const local=id=>({id,title:'Walking',startedAt:1,endedAt:2});

it('lists an activity once when the phone writes its id in upper case and the cloud in lower case',()=>{
 const lower='10903246-25d7-4080-8610-a196bed9d3ba',upper=lower.toUpperCase();
 const merged=mergeGroupingActivities({localActivities:[local(upper)],rows:{[lower]:row(lower)},ids:[lower,upper],detailed:new Set()});
 expect(merged).toHaveLength(1);
 expect(merged[0].id).toBe(upper);
});
it('still lists cloud-only activities and keeps each phone activity once',()=>{
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const merged=mergeGroupingActivities({localActivities:[local(a.toUpperCase())],rows:{[a]:row(a),[b]:row(b)},ids:[a,a.toUpperCase(),b],detailed:new Set()});
 expect(merged.map(x=>x.id.toLowerCase())).toEqual([a,b]);
 expect(merged[1].source).toBe('cloud');
});
it('skips ids it knows nothing about',()=>{
 expect(mergeGroupingActivities({localActivities:[],rows:{},ids:['missing'],detailed:new Set()})).toEqual([]);
});
it('never lists a deleted activity, from the phone or the cloud, in either case',()=>{
 const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const merged=mergeGroupingActivities({localActivities:[local(id.toUpperCase())],rows:{[id]:row(id)},ids:[id,id.toUpperCase()],detailed:new Set(),deleted:new Set([id])});
 expect(merged).toEqual([]);
});
