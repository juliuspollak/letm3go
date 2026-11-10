import {renderHook,waitFor,act,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {createJourneySync} from './journeyMetadataStore.js';
import {cloudPageRequest,loadCloudJourneyDetail,useCloudJourneyPage} from './useCloudJourneyPage.js';
const mocked=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:mocked}));
const owner='owner',row={id:'a',owner_id:owner,title:'Saved walk',activity:'Walking',recording_mode:'manual',started_at:'2026-11-08T00:00:00Z',ended_at:'2026-11-08T00:01:00Z',distance_meters:10,duration_seconds:60,route_points:null,revision:1};
const answer=()=>({...emptyGrouping(owner),complete:true,scope:['a'],details:[],revision:1,pageRefs:['a'],nextActivity:null,activityRows:[row]});
let online=true;
beforeEach(()=>{online=true;vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);mocked.rpc.mockReset();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function device(){let rows={};const sync=createJourneySync({owner,preferences:{},savePreferences:async()=>{},storage:{read:async()=>structuredClone(rows),commit:async ops=>{for(const op of ops)if(op.remove)delete rows[op.key];else rows[op.key]=structuredClone(op.value);}}});await sync.ready();await sync.write(latest=>({status:{...latest.status,migratedAt:1}}));return sync;}
it('builds calendar overlap and server filter requests without geometry',()=>{
 expect(cloudPageRequest({date:'2026-11-08',query:' Cafe ',activity:'Walking',equipment:'bike',favourites:['journey:a'],archived:['b'],sort:'distance'},new Date('2026-11-08T12:00:00Z'))).toMatchObject({p_list:true,p_query:'Cafe',p_equipment:'bike',p_favourite_refs:['a'],p_archived_refs:['b'],p_sort:'distance'});
 expect(cloudPageRequest({date:'all'}).p_from).toBeNull();
});
it('loads a summary page, persists it, and uses it offline without fetching GPS',async()=>{
 const sync=await device();mocked.rpc.mockResolvedValue({data:answer()});
 const first=renderHook(()=>useCloudJourneyPage({owner,sync,date:'all'}));
 await waitFor(()=>expect(first.result.current.ids).toEqual(['a']));
 expect(mocked.rpc).toHaveBeenCalledWith('journey_metadata_snapshot',expect.objectContaining({p_refs:[],p_list:true,p_geometry:false}));
 first.unmount();online=false;mocked.rpc.mockClear();
 const cached=renderHook(()=>useCloudJourneyPage({owner,sync,date:'all'}));
 await waitFor(()=>expect(cached.result.current.loading).toBe(false));expect(cached.result.current.ids).toEqual(['a']);expect(mocked.rpc).not.toHaveBeenCalled();
});
it('reports an uncached offline page instead of representing it as an empty successful history',async()=>{
 const sync=await device();online=false;
 const {result}=renderHook(()=>useCloudJourneyPage({owner,sync,date:'all'}));
 await waitFor(()=>expect(result.current.error).toContain('not cached'));expect(mocked.rpc).not.toHaveBeenCalled();
});
it('loads an uncached saved route once and then reopens it offline without reconstruction',async()=>{
 const sync=await device(),points=[{latitude:1,longitude:2,timestamp:1},{latitude:1.001,longitude:2,timestamp:61}];
 mocked.rpc.mockResolvedValue({data:{...answer(),details:['a'],activityRows:[{...row,route_points:points}]}});
 const [activity]=await loadCloudJourneyDetail({owner,sync,refs:['a'],client:mocked});expect(activity.points).toHaveLength(2);expect(activity.geometryLoaded).toBe(true);
 expect(mocked.rpc).toHaveBeenCalledOnce();online=false;
 expect((await loadCloudJourneyDetail({owner,sync,refs:['a'],client:mocked}))[0].cloudStale).toBe(true);expect(mocked.rpc).toHaveBeenCalledOnce();
 await expect(loadCloudJourneyDetail({owner,sync,refs:['never-cached'],client:mocked})).rejects.toThrow('not cached');
});
it('discards a late page response after switching filters',async()=>{
 const sync=await device();let finish;
 mocked.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({data:{...answer(),scope:[],pageRefs:[],activityRows:[]}});
 const {result,rerender}=renderHook(({date})=>useCloudJourneyPage({owner,sync,date}),{initialProps:{date:'all'}});
 await waitFor(()=>expect(mocked.rpc).toHaveBeenCalledOnce());rerender({date:'today'});
 await waitFor(()=>expect(result.current.loading).toBe(false));
 await act(async()=>finish({data:answer()}));expect(result.current.ids).toEqual([]);expect(sync.read().activityRows.a).toBeUndefined();
});

it('verifies legacy metadata before replacing a history page, including an old migratedAt stamp',async()=>{
 const {applyChanges}=await import('./journeyMetadata.js');
 const sync=await device();
 await sync.write(latest=>({metadata:{...latest.metadata,titles:{old:'A saved legacy title'}},cache:{...latest.cache,migrationRequired:true}}));
 let cloud=emptyGrouping(owner),revision=1,applied=0;
 mocked.rpc.mockImplementation(async(name,args)=>{
  if(name==='journey_apply_changes'){applied++;cloud=applyChanges(cloud,args.p_changes);return {data:{revision:++revision,overwritten:[]}};}
  if(args?.p_refs)return {data:{...answer(),...cloud,revision}};
  return {data:{...cloud,revision}};
 });
 const {result}=renderHook(()=>useCloudJourneyPage({owner,sync,date:'all'}));
 await waitFor(()=>expect(result.current.ids).toEqual(['a']));
 expect(cloud.titles.old).toBe('A saved legacy title');expect(applied).toBe(1);
 expect(sync.read().cache.migrationRequired).toBe(false);expect(result.current.error).toBe('');
});
it('preserves the complete legacy mirror when cloud verification cannot finish',async()=>{
 const sync=await device();await sync.write(latest=>({metadata:{...latest.metadata,titles:{old:'Keep this title'}},cache:{...latest.cache,migrationRequired:true}}));
 mocked.rpc.mockResolvedValue({error:{message:'Network unavailable'}});
 const {result}=renderHook(()=>useCloudJourneyPage({owner,sync,date:'all'}));
 await waitFor(()=>expect(result.current.error).toContain('Network unavailable'));
 expect(sync.read().metadata.titles.old).toBe('Keep this title');expect(sync.read().cache.migrationRequired).toBe(true);
 expect(sync.read().activityRows||{}).toEqual({});
});
