// Sharing my earlier completed activities with my household (only after I agree, in the household settings).
// The database lists what is eligible and the journeys function publishes it through the same masked, atomic
// path as every other share, from the recordings already stored in Supabase (not from this phone), a few at a
// time. This loops until nothing is left, stops when a round makes no progress (what remains cannot be shared
// now) and is safe to run again: nothing is published twice.
export async function runHistoryBackfill({client,onProgress,maxRounds=80}){
 let published=0,failed=0,remaining=null;
 for(let round=0;round<maxRounds;round++){
  const {data,error}=await client.functions.invoke('journeys',{body:{action:'backfillHistory'},timeout:60000});
  if(error||!data||data.error)throw new Error(data?.error||'Sharing earlier activities could not be completed. Try again.');
  if(data.needsHome)return {published,failed,remaining:Number(data.remaining)||0,needsHome:true};
  published+=Number(data.published)||0;failed+=Number(data.failed)||0;remaining=Number(data.remaining)||0;
  onProgress?.({published,remaining});
  if(!remaining||!data.published)break;
 }
 return {published,failed,remaining:remaining??0,needsHome:false};
}
export async function readHistorySharing(client){
 try{const {data,error}=await client.rpc('my_history_sharing');return !error&&data?data:null;}catch{return null;}
}
export async function setHistorySharing(client,enabled){
 const {error}=await client.rpc('set_history_sharing',{p_enabled:enabled});
 if(error)throw new Error('Could not change sharing of earlier activities. Try again.');
}
