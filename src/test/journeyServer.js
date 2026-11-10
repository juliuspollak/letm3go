// A stand-in for Supabase's journey RPCs and for the device's durable storage, shared by
// the journey metadata tests. It enforces the same revision check the real RPC does.
import {vi} from 'vitest';
import {emptyGrouping} from '../lib/journeyGrouping.js';
import {applyChanges} from '../lib/journeyMetadata.js';
import {APPLY_FUNCTION,REVISION_FUNCTION,SNAPSHOT_FUNCTION} from '../lib/journeyMetadataStore.js';
export function memoryStorage(initial={}){
 const rows={...initial};
 return {rows,read:async()=>({...rows}),commit:vi.fn(async operations=>{for(const {key,value,remove} of operations){if(remove)delete rows[key];else rows[key]=value;}})};
}
export function fakeSupabase({owner='owner',titles={},revision=1,savedPlaces=[],fail=null}={}){
 const server={metadata:{...emptyGrouping(owner),titles:{...titles}},revision,calls:[],applied:[]};
 const rpc=vi.fn(async(name,args)=>{
  server.calls.push([name,args]);
  if(fail?.[name]){const error=fail[name](server);if(error)return {data:null,error};}
  if(name===REVISION_FUNCTION)return {data:server.revision,error:null};
  if(name===APPLY_FUNCTION){
   if(args.p_expected_revision!=null&&args.p_expected_revision!==server.revision)return {data:null,error:{message:'Journey information changed on another device; reload before saving again (conflict)'}};
   server.metadata=applyChanges(server.metadata,args.p_changes);server.revision+=1;server.applied.push(args.p_changes);
   return {data:{revision:server.revision,overwritten:[]},error:null};
  }
  if(name===SNAPSHOT_FUNCTION){
   if(args.p_since_revision!==undefined)return {data:{invalidations:[{domain:'activities',ref:'a',revision:server.revision}],next:null,atRevision:server.revision},error:null};
   const {version,owner:o,links,cuts,history,sourceLinks,titles:t,types,places,stopEdits,manualTags,hiddenTags,roads,enriched,distanceSummaries,enrichFrom}=server.metadata;
   return {data:{version,owner:o,links,cuts,history,sourceLinks,titles:t,types,places,stopEdits,manualTags,hiddenTags,roads,enriched,distanceSummaries,enrichFrom,
    scope:args.p_refs,details:args.p_detail_refs||[],complete:true,revision:server.revision,activityRows:[],pageRefs:[],recordsExist:true,savedPlaces,unavailableRefs:[]},error:null};
  }
  return {data:null,error:{message:`unexpected ${name}`}};
 });
 return {rpc,server};
}
