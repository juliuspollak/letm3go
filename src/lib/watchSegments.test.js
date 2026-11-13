import {webcrypto} from 'node:crypto';
import {expect,it} from 'vitest';
import {buildWatchSegments,canonicalSegmentAttempts,segmentReferences,WATCH_SEGMENT_LIMIT} from './watchSegments.js';
const ownerID='11111111-1111-4111-8111-111111111111';
const points=Array.from({length:121},(_,i)=>({latitude:0,longitude:i*5/111320,timestamp:1000+i,accuracy:5,segment:0}));
const trip={id:'ride',source:'watch',recordingMode:'watch',activity:'MTB',startedAt:1000,endedAt:1120,points,details:{namedSegments:[{id:'saved',name:'Saved descent',startIndex:0,endIndex:120,startTimestamp:1000,endTimestamp:1120,durationSeconds:120,gapSeconds:0}]}};
const community=(id='public')=>({id,name:'Public descent',activity:'MTB',status:'approved',visibility:'public',direction:'forward',version:1,geometry:points.map(p=>[p.latitude,p.longitude])});
const build=extra=>buildWatchSegments({ownerID,trips:[trip],cryptoImpl:webcrypto,...extra});
it('includes saved and approved public segments with clean PR dates and ride links',async()=>{
 const result=await build({publicSegments:[community()],now:2000});
 expect(result.ownerID).toBe(ownerID);expect(result.definitions).toHaveLength(2);
 expect(result.definitions[0]).toMatchObject({id:'saved',name:'Saved descent',bestActivityID:'ride',bestAt:1000});
 expect(result.definitions[0].bestSeconds).toBeGreaterThan(110);
 expect(result.definitions[0].reference[0]).toEqual([0,0,0]);
 expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
 expect((await build({publicSegments:[community()],now:3000})).revision).toBe(result.revision);
});
it('never exports other peoples private or pending public geometry',async()=>{
 const result=await build({publicSegments:[{...community('private'),visibility:'private'},{...community('pending'),status:'submitted'}]});
 expect(result.definitions.map(d=>d.id)).toEqual(['saved']);
});
it('uses the current published geometry instead of a local section with the same id',()=>{
 const current={...community('saved'),name:'Current route',geometry:points.slice(0,61).map(p=>[p.latitude,p.longitude])};
 const refs=segmentReferences([trip],[current]);
 expect(refs).toHaveLength(1);expect(refs[0].definition.name).toBe('Current route');expect(refs[0].definition.lengthMeters).toBeLessThan(310);
});
it('keeps forward and reverse targets independent',async()=>{
 const result=await build({publicSegments:[{...community(),direction:'both'}]});
 expect(result.definitions.map(d=>d.id)).toEqual(['saved','public','public:reverse']);
 expect(result.definitions.at(-1).name).toContain('reverse');
 expect(result.definitions.at(-1).bestSeconds).toBeUndefined();
});
it('bounds the catalogue and carries public segments with no prior local effort',async()=>{
 const result=await build({trips:[],publicSegments:Array.from({length:200},(_,i)=>community(`s${i}`))});
 expect(result.definitions).toHaveLength(WATCH_SEGMENT_LIMIT);
 expect(result.definitions.every(d=>d.bestSeconds===undefined)).toBe(true);
});
it('prefers a Watch attempt over its simultaneous automatic phone recording without merging real laps',()=>{
 const attempts=[{trip:{id:'auto',recordingMode:'automatic'},startedAt:10,elapsedSeconds:90},{trip:{id:'watch',source:'watch'},startedAt:0,elapsedSeconds:120},{trip:{id:'watch',source:'watch'},startedAt:200,elapsedSeconds:120}];
 const result=canonicalSegmentAttempts(attempts);expect(result).toHaveLength(2);expect(result.every(a=>a.trip.id==='watch')).toBe(true);
});
it('does not turn a recording break into a PR',async()=>{
 const broken={...trip,details:{},points:points.map((p,i)=>({...p,segment:i<60?0:1}))};
 const result=await build({trips:[broken],publicSegments:[community()]});
 expect(result.definitions[0].bestSeconds).toBeUndefined();
});
