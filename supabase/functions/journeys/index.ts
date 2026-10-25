// Proposed server implementation. NOT deployed in this milestone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { redactRoute, metersBetween } from '../_shared/activityPrivacy.js';
import { boundedJSON, sanitizeJPEG } from '../_shared/media.js';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const r2=()=>new S3Client({region:Deno.env.get('R2_REGION')||'auto',endpoint:Deno.env.get('R2_ENDPOINT'),credentials:{accessKeyId:Deno.env.get('R2_ACCESS_KEY_ID')!,secretAccessKey:Deno.env.get('R2_SECRET_ACCESS_KEY')!}});
 const bucket=Deno.env.get('R2_BUCKET_NAME')!;
 try{
  const token=new URL(request.url).searchParams.get('token');
  if(request.method==='GET'&&uuid(token)){
   const publicClient=createClient(url,anon,{auth:{persistSession:false}});
   const {data,error}=await publicClient.from('shared_journeys').select('token,snapshot,created_at').eq('token',token).maybeSingle();
   if(error||!data)return reply({error:'Journey unavailable'},404);
   const {data:budget}=await admin.rpc('consume_operation',{p_key:`public:${token}`,p_max:300});if(!budget)return reply({error:'Please retry later'},429);
   const photoID=new URL(request.url).searchParams.get('photo');
   if(photoID){
    if(!uuid(photoID)||!data.snapshot.photos?.some((p:{id:string})=>p.id===photoID))return reply({error:'Photo unavailable'},404);
    const {data:asset}=await admin.from('media_assets').select('object_key').eq('id',photoID).maybeSingle();
    if(!asset)return reply({error:'Photo unavailable'},404);
    return reply({url:await getSignedUrl(r2(),new GetObjectCommand({Bucket:bucket,Key:asset.object_key}),{expiresIn:60})});
   }
   return reply(data);
  }
  if(request.method!=='POST')return reply({error:'Unsupported request'},405);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data:auth,error:authError}=await userClient.auth.getUser();
  if(authError||!auth.user)return reply({error:'Sign in required'},401);
  const owner=auth.user.id;
  const {data:deleting,error:deletionError}=await admin.from('account_deletion_requests').select('owner_id').eq('owner_id',owner).maybeSingle();
  if(deletionError)return reply({error:'Account services need backend configuration'},503);
  if(deleting)return reply({error:'Account deletion is in progress'},409);
  const {data:budget}=await admin.rpc('consume_operation',{p_key:`user:${owner}`,p_max:120});if(!budget)return reply({error:'Please retry later'},429);
  const body=await boundedJSON(request);
  if(body.action==='publicMedia'){
   if(!uuid(body.token)||!uuid(body.mediaID))return reply({error:'Invalid request'},400);
   const {data:shared}=await userClient.from('shared_journeys').select('snapshot').eq('token',body.token).maybeSingle();
   if(!shared?.snapshot.photos?.some((p:{id:string})=>p.id===body.mediaID))return reply({error:'Photo unavailable'},404);
   const {data:asset}=await admin.from('media_assets').select('object_key').eq('id',body.mediaID).maybeSingle();
   if(!asset)return reply({error:'Photo unavailable'},404);
   return reply({url:await getSignedUrl(r2(),new GetObjectCommand({Bucket:bucket,Key:asset.object_key}),{expiresIn:60})});
  }
  if(!uuid(body.id))return reply({error:'Activity identifier required'},400);
  if(body.action==='status'){
   const {data:shared,error}=await admin.from('shared_journeys').select('audience,token').eq('activity_id',body.id).eq('owner_id',owner).maybeSingle();if(error)throw error;
   return reply({audience:shared?.audience||'private',token:shared?.token||null});
  }
  const {data:trip,error}=await userClient.from('activities').select('*').eq('id',body.id).maybeSingle();
  if(error||!trip||trip.owner_id!==owner)return reply({error:'Activity unavailable'},404);
  if(body.action==='publish'){
   if(!['public','household','friends'].includes(body.audience)||body.revision!==trip.revision)return reply({error:'Review the current activity and audience before publishing'},409);
   // Query the at-most-two sensitive places explicitly; favourites must not crowd
   // Home/Work out of PostgREST's default row limit and weaken route masking.
   const {data:places,error:placesError}=await userClient.from('saved_places').select('*').in('kind',['home','work']);if(placesError)throw placesError;
   // Fail closed: a client must confirm its saved places were synchronised before preview.
   if(body.placesConfirmed!==true)return reply({error:'Sync saved Home/Work places and review masking first'},400);
   const {data:assets,error:mediaError}=await userClient.from('media_assets').select('id,caption,latitude,longitude').eq('activity_id',trip.id);if(mediaError)throw mediaError;
   const selected=Array.isArray(body.photoIDs)?body.photoIDs.slice(0,50):[];
   const safePhotos=(assets||[]).filter(p=>selected.includes(p.id)&&!places?.some(place=>['home','work'].includes(place.kind)&&p.latitude!=null&&p.longitude!=null&&metersBetween(p,place)<=place.radius+300)).map(p=>({id:p.id,caption:p.caption}));
   const snapshot={title:trip.title,activity:trip.activity,description:trip.description,points:redactRoute(trip.route_points,places||[]),photos:safePhotos};
   const {data:result,error:commitError}=await admin.rpc('commit_shared_journey',{p_id:trip.id,p_owner:owner,p_revision:trip.revision,p_audience:body.audience,p_snapshot:snapshot});if(commitError)throw commitError;
   return reply({token:result,snapshot});
  }
  if(body.action==='revoke'){const {error}=await userClient.rpc('revoke_activity_publication',{p_id:trip.id});if(error)throw error;return reply({revoked:true});}
  if(body.action==='upload'){
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
   await r2().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:image,ContentType:'image/jpeg',CacheControl:'private, max-age=60'}));
   const {error:insertError}=await admin.from('media_assets').insert({id:mediaID,owner_id:owner,activity_id:trip.id,object_key:key,caption:String(body.caption||'').slice(0,500),byte_size:image.length,mime_type:'image/jpeg'});
   if(insertError){await r2().send(new DeleteObjectCommand({Bucket:bucket,Key:key}));throw insertError;}
   return reply({id:mediaID});
  }
  if(body.action==='download'){
   const {data:asset}=await userClient.from('media_assets').select('object_key').eq('id',body.mediaID).eq('activity_id',trip.id).maybeSingle();
   if(!asset)return reply({error:'Photo unavailable'},404);
   return reply({url:await getSignedUrl(r2(),new GetObjectCommand({Bucket:bucket,Key:asset.object_key}),{expiresIn:60})});
  }
  return reply({error:'Unsupported action'},400);
 }catch(error){console.error('Journey operation failed',error instanceof Error?error.name:'unknown');return reply({error:'Unable to complete journey operation'},400);}
});
