import { expect,it,vi } from 'vitest';
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'ios'},registerPlugin:()=>({})}));
import { mapPayload } from './appleMaps.js';
it('preserves route gaps and forwards photo references without private image paths or GPS timestamps',()=>{
 const payload=mapPayload([{id:'trip',routeSegments:[[[1,2],[3,4]],[[5,6],[7,8]]],photos:[{id:'photo',point:[3,4],caption:'Stop',url:'private://secret',exif:{secret:true}}],route:[],startedAt:'secret'}]);
 expect(payload.routes).toEqual([[[1,2],[3,4]],[[5,6],[7,8]]]);
 expect(payload.pins.find(p=>p.kind==='photo')).toEqual({point:[3,4],title:'Stop',kind:'photo',journeyID:'trip',photoID:'photo'});
 expect(JSON.stringify(payload)).not.toContain('secret');
});
it('rejects non-finite and out-of-range locations and includes current-location accuracy',()=>{
 const result=mapPayload([{route:[[NaN,2],[100,4],[1,2]],photos:[]}],{latitude:0,longitude:0,accuracy:25});
 expect(result.routes).toEqual([[[1,2]]]);expect(result.pins.at(-1)).toMatchObject({point:[0,0],radius:25,kind:'location'});
});
