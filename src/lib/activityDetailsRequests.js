import {recordedJourney,recorder} from './recorder.js';
import {sharingRequest,publishActivity,makeActivityPrivate} from './activitySharing.js';
import {sharingSelection} from './socialSelection.js';
import {invitationMessage} from './invitationLink.js';
import {routeBounds,trailCandidates,trailLinkPayload} from './mtbLink.js';
import {MTB_ACCESS_LABELS} from './mtb.js';
import * as mtbApi from './mtbApi.js';
import {scanRoutePlaces} from './routePlaceScan.js';
import {saveMaximum} from './heartRate.js';
import {sendReportAsFeedback,feedbackReference} from './feedback.js';
import {buildCollectionItem,collectionItemError,categoriesForActivity,COLLECTION_CATEGORIES} from './collection.js';
import {rememberDestinationPlace} from './rememberedPlace.js';
import {cachedKnownTags,TAG_LIMIT} from './tagSearch.js';
import {commitTagAndPlace} from './tagCommit.js';

const trailDistance=m=>Number.isFinite(m)?(m>=1000?`${(m/1000).toFixed(1)} km`:`${Math.round(m)} m`):'Unknown length';

// Everything the native screen cannot do itself, because the session or the rule
// belongs to JavaScript: supabase-js stays the only owner of the session, so no
// token crosses to Swift, only the answer. `context` is read at call time, so a
// reply always reflects the current account and activity. Every operation here is
// the one the React screen calls.
export const activityDetailsRequests={
 async sharedPhoto({client,trip},{photoID}){
  if(trip.source!=='cloud'||!trip.photos?.some(photo=>photo.id===photoID))throw new Error('Photo unavailable.');
  const {data,error}=await client.functions.invoke('journeys',{body:{action:'download',id:trip.id,mediaID:photoID}});
  if(error||!data?.url)throw new Error('Saved photo is unavailable.');return {url:data.url};
 },
 // The Share sheet: who can see this activity now, and who it could be shared
 // with. The database is the authority for both (my_activity_sharing).
 async privacyStatus({client,trip}){
  const [sharing,friends,household]=await Promise.all([
   client.rpc('my_activity_sharing',{p_activity:trip.id}),client.rpc('my_friends'),client.rpc('my_household')]);
  if(sharing.error||!sharing.data){
   // A database without the sharing migration still answers public/private.
   const result=await sharingRequest(client,'status',trip.id);
   return {audience:result.audience,household:false,friends:[],options:{friends:[],household:null}};
  }
  const people=(friends.data||[]).filter(f=>f?.user_id).map(f=>({id:String(f.user_id),name:f.display_name||'Friend'}));
  return {audience:sharing.data.audience,household:sharing.data.household===true,
   friends:(sharing.data.friends||[]).map(String).filter(id=>people.some(p=>p.id===id)),
   options:{friends:people,household:household.data?.[0]?.name||null}};
 },
 // Save replaces the whole selection in one server transaction; nothing changes
 // locally until the server confirms, so a failure keeps the last confirmed state.
 async privacySave({client,trip,auth},{choice,household=false,friends=[]},{signal}={}){
  if(choice==='private'){await makeActivityPrivate(client,trip.id);return {audience:'private',household:false,friends:[],message:'Private. Nobody else can see this activity now. Copies others already saved cannot be recalled.'};}
  const scope=choice==='public'?sharingSelection({link:true}):sharingSelection({household:household===true,allFriends:false,selected:(Array.isArray(friends)?friends:[]).map(String)});
  await sharingRequest(client,'status',trip.id);
  const state=await recorder.getState();
  await publishActivity({client,state,id:trip.id,reviewedTrip:trip,signal,receipts:auth.preferences.syncReceipts||{},checkpoint:syncReceipts=>auth.savePreferences({syncReceipts}),
   audience:scope.audience,mode:scope.mode,recipients:scope.recipients});
  if(choice==='public')return {audience:'public',household:false,friends:[],message:'Public. The reviewed route copy is now available to anyone with the link. Photos were not published.'};
  const who=[household?'your household':null,friends.length?`${friends.length} friend${friends.length===1?'':'s'}`:null].filter(Boolean).join(' and ');
  return {audience:scope.audience,household:household===true,friends:scope.recipients,message:`Shared with ${who}. They see a read-only copy with Home and Work hidden.`};
 },
 // "Add friends" in the Share sheet: the same invitation Social → Friends creates.
 async createFriendInvite({client}){
  const {data,error}=await client.rpc('create_friend_invite');
  if(error||!data)throw new Error('The invitation could not be created. Check your connection and retry.');
  return {text:invitationMessage(data)};
 },
 async groupingAct({grouping},{action}){
  if(!grouping)throw new Error('Journey details are unavailable.');
  const ok=await grouping.act(action);
  if(!ok)throw new Error(grouping.error||'That change could not be saved.');
  return {};
 },
 // The activity's recording report, sent as feedback instead of copied.
 async sendRecordingReport({client,trip},{note='',report='',token,reportID},{signal}={}){
  if(!client)throw new Error('Sending needs a connection to your account.');
  const day=Number.isFinite(trip.startedAt)?new Date(trip.startedAt*1000).toLocaleDateString('en-AU'):'';
  const ticket=await sendReportAsFeedback(client,{token,reportID,kind:'recording',title:`Recording report · ${trip.title||'Activity'}${day?` · ${day}`:''}`,note,text:report,native:true,signal});
  return {reference:feedbackReference(ticket)};
 },
 async scanPlaces({trip,grouping},args,{signal,progress}){
  const anchor=trip.segmentIDs?.[0]||trip.id;
  const result=await scanRoutePlaces(trip,{hidden:grouping?.metadata?.hiddenTags?.[anchor]||[],places:grouping?.metadata?.places,signal,onProgress:({notice})=>progress?.(notice)});
  return {notice:result.notice,suggestions:result.suggestions.map(item=>({tag:item.tag,source:item.source||'Apple Maps'}))};
 },
 // One press of the tags button: the same coordinator the React section uses, so
 // a partial failure reads the same on both and leaves the same things for a
 // retry. The activity's own tags are read here rather than sent from Swift, so a
 // screen that is a moment out of date can never drop a tag added meanwhile.
 async tagAndRemember({trip,run,grouping,places,lastError},{name,remember=false}){
  const anchor=trip.segmentIDs?.[0]||trip.id;
  const custom=grouping?.metadata?.manualTags?.[anchor]||[];
  const auto=(trip.tags||[]).filter(tag=>!custom.some(own=>own.toLowerCase()===tag.toLowerCase()));
  return commitTagAndPlace({name,known:cachedKnownTags(grouping?.journeys),applied:[...auto,...custom],custom,
   remember:remember===true,canRemember:true,limit:TAG_LIMIT,
   addTag:tags=>grouping.act({type:'manualTags',anchor,tags}),
   savePlace:label=>rememberDestinationPlace({trip,run,places,name:label,lastError})});
 },
 async findTrails({trip}){
  const route=Array.isArray(trip.route)?trip.route:[];
  const bbox=routeBounds(route);
  if(!bbox)return {trails:[],note:'This ride has no GPS route to search near.'};
  const candidates=trailCandidates(await mtbApi.fetchTrails(bbox),route);
  return {trails:candidates.map(candidate=>({...trailLinkPayload(candidate),id:candidate.id,name:candidate.name,detail:`${trailDistance(candidate.distanceMeters)} · ${candidate.difficulty} · ${MTB_ACCESS_LABELS[candidate.access]||candidate.access}${candidate.startDistanceMeters!=null?` · starts ${trailDistance(candidate.startDistanceMeters)} from this ride`:''}`}))};
 },
 async setMaximumHeartRate({ownerID,refreshPresentation},{value}){
  const maximum=saveMaximum(ownerID,value);
  refreshPresentation?.();
  return {maximum};
 },
 async equipmentCategories({trip}){
  const preferred=categoriesForActivity(trip.activity).map(category=>category.id);
  return {categories:COLLECTION_CATEGORIES.map(category=>({id:category.id,label:category.label,preferred:preferred.includes(category.id)}))};
 },
 async addEquipment({addEquipmentItem},{category,name,make,model}){
  const item=buildCollectionItem({category,name,make,model});
  const problem=collectionItemError(item);
  if(problem)throw new Error(problem);
  if(!await addEquipmentItem?.(item))throw new Error('This item could not be added to your Collection.');
  return {id:String(item.id)};
 },
 async openActivity({activities,grouping,onSource,trip},{id}){
  const target=(trip.sourceRecords||[]).find(s=>String(s.id)===id)||grouping?.journeys?.find(j=>String(j.id)===id)||activities.find(j=>String(j.id)===id);
  if(!target||!onSource)throw new Error('That activity is not available.');
  onSource(target);
  return {};
 },
};

// After a native mutation: the same step the React screen takes after a write.
export async function acceptNativeMutation({run,onUpdated,onDeleted,activityID,kind}){
 if(kind==='deleted'){onDeleted?.();return;}
 const result=await run('getState');
 const updated=result?.trips?.find(trip=>trip.id===activityID);
 if(updated)onUpdated?.(recordedJourney(updated));
}
