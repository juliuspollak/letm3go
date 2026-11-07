import {expect,it} from 'vitest';
import {sharedSnapshotActivity} from './sharedSnapshotActivity.js';
it('retains only redacted snapshot fields and segment gaps',()=>{
 const result=sharedSnapshotActivity({title:'Walk',activity:'Walking',startedAt:'2026-11-07T08:00:00Z',endedAt:'2026-11-07T08:30:00Z',distanceMeters:2500,points:[{latitude:-34,longitude:151,segment:0},{latitude:-34.01,longitude:151.01,segment:0},{latitude:-34.1,longitude:151.1,segment:3},{latitude:-34.11,longitude:151.11,segment:3}],photos:[{id:'p1',caption:'Beach',latitude:-34.01,longitude:151.01},{id:'p2',caption:'No location'}],privateNotes:'never'},'journey','Julia');
 expect(result.routeSegments).toHaveLength(2);
 expect(result.photos.map(p=>p.point)).toEqual([[-34.01,151.01],null]);
 expect(result).toMatchObject({readOnly:true,source:'shared',isShared:true,id:'shared:journey',ownerName:'Julia',tags:[],notes:''});
 expect(JSON.stringify(result)).not.toContain('never');
});
it('rejects missing approved server route metadata',()=>expect(()=>sharedSnapshotActivity(null,'trip')).toThrow());
