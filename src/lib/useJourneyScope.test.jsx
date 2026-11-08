import {renderHook,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {emptyGrouping} from './journeyGrouping.js';
import {createJourneySync} from './journeyMetadataStore.js';
import {mergeScope} from './journeyCache.js';
import {useJourneyScope} from './useJourneyScope.js';
const cloud=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:cloud}));
let online=true;
beforeEach(()=>{cloud.rpc.mockReset();online=true;vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function fixture(){const owner='owner',sync=createJourneySync({owner,preferences:{},savePreferences:async()=>{},storage:{read:async()=>({}),commit:async()=>{}}});await sync.ready();return sync;}
it('opens a complete cached route offline even if a known revision made it stale',async()=>{
 const sync=await fixture(),snapshot={metadata:emptyGrouping('owner'),scope:['a'],revision:1,activityRows:[{id:'a',route_points:[]}]};
 await sync.write(state=>mergeScope(state,snapshot,['a'],['a']));
 await sync.write(state=>({cache:{...state.cache,scopes:Object.fromEntries(Object.entries(state.cache.scopes).map(([key,scope])=>[key,{...scope,stale:true}]))}}));
 online=false;const {result}=renderHook(()=>useJourneyScope({owner:'owner',sync,refs:['a'],details:['a']}));
 await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.error).toBe('');expect(cloud.rpc).not.toHaveBeenCalled();
});
it('requires saved GPS when metadata exists but geometry has been evicted',async()=>{
 const sync=await fixture();await sync.write(state=>mergeScope(state,{metadata:emptyGrouping('owner'),scope:['a'],revision:1,activityRows:[{id:'a',route_points:null}]},['a'],[]));
 online=false;const {result}=renderHook(()=>useJourneyScope({owner:'owner',sync,refs:['a'],details:['a']}));
 await waitFor(()=>expect(result.current.error).toContain('not cached'));expect(cloud.rpc).not.toHaveBeenCalled();
});
it('reports missing related recordings rather than silently claiming complete grouping',async()=>{
 const sync=await fixture();cloud.rpc.mockResolvedValue({data:{...emptyGrouping('owner'),complete:true,scope:['a','missing'],details:[],unavailableRefs:['missing'],activityRows:[],revision:1}});
 const {result}=renderHook(()=>useJourneyScope({owner:'owner',sync,refs:['a']}));
 await waitFor(()=>expect(result.current.error).toContain('cannot be shown as complete'));
});
