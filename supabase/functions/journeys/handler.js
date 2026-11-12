// JWT-verified journeys endpoint: private media, sharing and publication. The logic
// lives here so it can be tested without Deno, R2 or a database; index.ts supplies the
// real Supabase client and the R2 storage. Behaviour is unchanged from when this was
// inline in index.ts.
import { redactRoute, metersBetween } from '../_shared/activityPrivacy.js';
import { boundedJSON, sanitizeJPEG } from '../_shared/media.js';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const uuid=(value)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// The recipient snapshot of one activity: the route is masked around Home and Work (see redactRoute) and,
// for a private audience, carries each point's capture time (a public link never does). Used by every path
// that publishes, so a manual share, automatic sharing and the historical backfill cannot differ.
const snapshotFor=(trip,places,safePhotos,privateAudience)=>({title:trip.title,activity:trip.activity,description:trip.description,startedAt:trip.started_at,endedAt:trip.ended_at,distanceMeters:trip.distance_meters,durationSeconds:trip.duration_seconds,points:redactRoute(trip.route_points,places||[],300,{times:privateAudience}),photos:safePhotos});
const hasHome=places=>(places||[]).some(p=>p.kind==='home'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
// env(name) -> string; createClient(url,key,options) -> Supabase client;
// storage: { signedGet(key) -> url, put(key,bytes), remove(key) }.
export function createJourneysHandler({ env, createClient, storage }) {
 return async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 const url=env('SUPABASE_URL'), anon=env('SUPABASE_ANON_KEY'), service=env('SUPABASE_SERVICE_ROLE_KEY');
 const admin=createClient(url,service,{auth:{persistSession:false}});
  let stage='initialisation';
 try{
  const token=new URL(request.url).searchParams.get('token');
  if(request.method==='GET'&&uuid(token)){
   const {data,error}=await admin.from('shared_journeys').select('token,snapshot,created_at').eq('token',token).eq('audience','public').maybeSingle();
   if(error||!data)return reply({error:'Journey unavailable'},404);
   const {data:budget}=await admin.rpc('consume_operation',{p_key:`public:${token}`,p_max:300});if(!budget)return reply({error:'Please retry later'},429);
   const photoID=new URL(request.url).searchParams.get('photo');
   if(photoID){
    if(!uuid(photoID)||!data.snapshot.photos?.some((p)=>p.id===photoID))return reply({error:'Photo unavailable'},404);
    const {data:asset}=await admin.from('media_assets').select('object_key').eq('id',photoID).maybeSingle();
    if(!asset)return reply({error:'Photo unavailable'},404);
    return reply({url:await storage.signedGet(asset.object_key)});
   }
   return reply(data);
  }
  // Private shares are always read using the viewer's JWT and the database's
  // current friendship/household policy. A token alone is never enough.
  const privateActivity=new URL(request.url).searchParams.get('activity');
  if(request.method==='GET'&&uuid(privateActivity)){
   const bearer=request.headers.get('Authorization')||'';
   if(!bearer.startsWith('Bearer '))return reply({error:'Sign in required'},401);
   const viewer=createClient(url,anon,{global:{headers:{Authorization:bearer}},auth:{persistSession:false}});
   const {data:user,error:authError}=await viewer.auth.getUser();
   if(authError||!user.user)return reply({error:'Sign in required'},401);
   const {data:budget,error:budgetError}=await admin.rpc('consume_operation',{p_key:`social-read:${user.user.id}`,p_max:300});
   if(budgetError||!budget)return reply({error:'Please retry later'},429);
   const {data:shared,error:accessError}=await viewer.rpc('read_social_journey',{p_activity:privateActivity});
   if(accessError)return reply({error:'Private sharing is not configured'},503);
   if(!shared?.snapshot)return reply({error:'Journey unavailable'},404);
   const photoID=new URL(request.url).searchParams.get('photo');
   if(photoID){
    if(!uuid(photoID)||!shared.snapshot.photos?.some((p)=>p.id===photoID))return reply({error:'Photo unavailable'},404);
    const {data:asset}=await admin.from('media_assets').select('object_key').eq('id',photoID).eq('activity_id',privateActivity).maybeSingle();
    if(!asset)return reply({error:'Photo unavailable'},404);
    return reply({url:await storage.signedGet(asset.object_key)});
   }
   return reply({snapshot:shared.snapshot});
  }
  if(request.method!=='POST')return reply({error:'Unsupported request'},405);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  stage='authentication';
  const {data:auth,error:authError}=await userClient.auth.getUser();
  if(authError||!auth.user)return reply({error:'Sign in required'},401);
  const owner=auth.user.id;
  stage='account_check';
  const {data:deleting,error:deletionError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',owner).maybeSingle();
  if(deletionError)return reply({error:'Account services need backend configuration'},503);
  if(deleting)return reply({error:'Account deletion is in progress'},409);
  stage='rate_limit';
  const {data:budget}=await admin.rpc('consume_operation',{p_key:`user:${owner}`,p_max:120});if(!budget)return reply({error:'Please retry later'},429);
  stage='request_parse';
  const body=await boundedJSON(request);
  if(body.action==='publicMedia'){
   if(!uuid(body.token)||!uuid(body.mediaID))return reply({error:'Invalid request'},400);
   const {data:shared}=await admin.from('shared_journeys').select('snapshot').eq('token',body.token).eq('audience','public').maybeSingle();
   if(!shared?.snapshot.photos?.some((p)=>p.id===body.mediaID))return reply({error:'Photo unavailable'},404);
   const {data:asset}=await admin.from('media_assets').select('object_key').eq('id',body.mediaID).maybeSingle();
   if(!asset)return reply({error:'Photo unavailable'},404);
   return reply({url:await storage.signedGet(asset.object_key)});
  }
  // Collection photos use the same private bucket, but a deterministic per-item
  // key derived from the verified JWT owner. One account can therefore never
  // write under another account's prefix, and a retry overwrites the same object
  // instead of creating a duplicate. Metadata is written by the authenticated
  // backup RPC afterwards, so a row is never created before its object exists.
  if(body.action==='collectionPhoto'){
   stage='collection_photo';
   if(!uuid(body.itemID)||typeof body.base64!=='string'||body.base64.length>6_700_000)return reply({error:'Invalid Collection photo'},400);
   if(typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256))return reply({error:'Invalid photo fingerprint'},400);
   const image=sanitizeJPEG(Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0)));
   const key=`${owner}/collection/${body.itemID}.jpg`;
   await storage.put(key,image);
   return reply({itemID:body.itemID,objectKey:key,sha256:body.sha256,byteSize:image.length});
  }
  if(body.action==='collectionDownload'){
   if(!uuid(body.itemID))return reply({error:'Invalid Collection item'},400);
   const {data:item,error}=await userClient.from('collection_items').select('photo_object_key').eq('id',body.itemID).maybeSingle();
   if(error)throw error;
   if(!item?.photo_object_key)return reply({error:'Photo unavailable'},404);
   return reply({url:await storage.signedGet(item.photo_object_key)});
  }
  if(!uuid(body.id))return reply({error:'Activity identifier required'},400);
  if(body.action==='status'){
   const {data:shared,error}=await admin.from('shared_journeys').select('audience,token').eq('activity_id',body.id).eq('owner_id',owner).maybeSingle();if(error)throw error;
   return reply({audience:shared?.audience||'private',token:shared?.token||null});
  }
  stage='activity_lookup';
  const {data:trip,error}=await userClient.from('activities').select('*').eq('id',body.id).maybeSingle();
  if(error||!trip||trip.owner_id!==owner)return reply({error:'Activity unavailable'},404);
  if(body.action==='publish'){
   if(body.auto===true&&(body.audience!=='household'||body.mode!=='household'||!Array.isArray(body.recipients)||body.recipients.length))return reply({error:'Automatic sharing is household only'},400);
   // Automatic household sharing never publishes an activity the owner has made private,
   // including one that was made private while this request was already on its way.
   if(body.auto===true){const {data:allowed,error:allowedError}=await admin.rpc('auto_share_allowed',{p_owner:owner,p_activity:trip.id});if(allowedError)throw allowedError;if(allowed!==true)return reply({error:'This activity is private'},409);}
   if(!['public','household','friends'].includes(body.audience)||body.revision!==trip.revision)return reply({error:'Review the current activity and audience before publishing'},409);
   // Query the at-most-two sensitive places explicitly; favourites must not crowd
   // Home/Work out of PostgREST's default row limit and weaken route masking.
   const {data:places,error:placesError}=await userClient.from('saved_places').select('*').in('kind',['home','work']);if(placesError)throw placesError;
   // A household already knows where Home is, so a household share does not need one (Home and Work are still hidden if saved); anyone else does.
   if(!(body.audience==='household'&&body.mode==='household')&&!hasHome(places))return reply({error:'Save a Home place before publishing GPS routes'},409);
   // Fail closed: a client must confirm its saved places were synchronised before preview.
   if(body.placesConfirmed!==true)return reply({error:'Sync saved Home/Work places and review masking first'},400);
   const {data:assets,error:mediaError}=await userClient.from('media_assets').select('id,caption,latitude,longitude').eq('activity_id',trip.id);if(mediaError)throw mediaError;
   const selected=Array.isArray(body.photoIDs)?body.photoIDs.slice(0,50):[];
   const safePhotos=(assets||[]).filter(p=>selected.includes(p.id)&&!places?.some(place=>['home','work'].includes(place.kind)&&p.latitude!=null&&p.longitude!=null&&metersBetween(p,place)<=place.radius+300)).map(p=>({id:p.id,caption:p.caption,latitude:p.latitude,longitude:p.longitude}));
   const privateAudience=body.audience==='friends'||body.audience==='household';
   // Private audiences also get each point's capture time (for the person's day timeline); a public link never does.
   const snapshot=snapshotFor(trip,places,safePhotos,privateAudience);
   if(privateAudience&&(!['friends','household','selected','mixed','all'].includes(body.mode)||!Array.isArray(body.recipients)||body.recipients.length>100))return reply({error:'Select valid social recipients'},400);
   const publication=privateAudience
    ?await admin.rpc('publish_social_journey',{p_owner:owner,p_activity:trip.id,p_revision:trip.revision,p_audience:body.audience,p_mode:body.mode,p_recipients:body.recipients,p_snapshot:snapshot,p_auto:body.auto===true})
    :await admin.rpc('commit_shared_journey',{p_id:trip.id,p_owner:owner,p_revision:trip.revision,p_audience:body.audience,p_snapshot:snapshot});
   const {data:result,error:commitError}=publication;
   if(commitError){
    if(body.auto===true&&/consent|eligible|household only/i.test(commitError.message||''))return reply({error:'Automatic sharing is no longer allowed'},409);
    throw commitError;
   }
   // Consent and manual decisions commit with the snapshot inside the RPC.
   // No compensating DELETE: it could fail, or remove a newer manual share.
   return reply({token:result,snapshot});
  }
  if(body.action==='revoke'){const {error}=await userClient.rpc('revoke_activity_publication',{p_id:trip.id});if(error)throw error;return reply({revoked:true});}
  if(body.action==='upload'){
   stage='photo_validation';
   const {count,error:countError}=await userClient.from('media_assets').select('id',{head:true,count:'exact'}).eq('activity_id',trip.id);if(countError)throw countError;
   if((count||0)>=50)return reply({error:'Photo limit reached'},429);
   if(typeof body.base64!=='string'||body.base64.length>6_700_000)return reply({error:'Image too large'},400);
   const image=sanitizeJPEG(Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0)));
   // The native photo ID is stable across retries; never upload two copies of the same photo.
   const mediaID=body.mediaID;
   if(!uuid(mediaID))return reply({error:'Invalid photo identifier'},400);
   const {data:existing,error:lookupError}=await userClient.from('media_assets').select('id').eq('id',mediaID).eq('activity_id',trip.id).maybeSingle();
   if(lookupError)throw lookupError;
   if(existing)return reply({id:mediaID,alreadyUploaded:true});
   const key=`${owner}/${trip.id}/${mediaID}.jpg`;
   stage='r2_upload';
   await storage.put(key,image);
   const latitude=typeof body.latitude==='number'&&Number.isFinite(body.latitude)&&Math.abs(body.latitude)<=90?body.latitude:null;
   const longitude=typeof body.longitude==='number'&&Number.isFinite(body.longitude)&&Math.abs(body.longitude)<=180?body.longitude:null;
   const locationSource=['gps','inferred'].includes(body.locationSource)&&latitude!==null&&longitude!==null?body.locationSource:'unlocated';
   stage='media_metadata';
   const {error:insertError}=await admin.from('media_assets').insert({id:mediaID,owner_id:owner,activity_id:trip.id,object_key:key,caption:String(body.caption||'').slice(0,500),byte_size:image.length,mime_type:'image/jpeg',latitude,longitude,location_source:locationSource});
   if(insertError){await storage.remove(key);throw insertError;}
   return reply({id:mediaID});
  }
  if(body.action==='download'){
   const {data:asset}=await userClient.from('media_assets').select('object_key').eq('id',body.mediaID).eq('activity_id',trip.id).maybeSingle();
   if(!asset)return reply({error:'Photo unavailable'},404);
   return reply({url:await storage.signedGet(asset.object_key)});
  }
  return reply({error:'Unsupported action'},400);
 }catch(error){console.error('Journey operation failed',stage,error instanceof Error?error.name:'unknown');return reply({error:'Cloud photo operation failed',stage},500);}
 };
}
