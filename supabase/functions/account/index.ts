import {removeFeedbackObjects} from '../_shared/feedbackStorage.js';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT, createRemoteJWKSet, jwtVerify } from 'npm:jose@6';
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from 'npm:@aws-sdk/client-s3@3';
import { boundedJSON } from '../_shared/media.js';
import { sealCredentials, openCredentials } from '../_shared/credentialCrypto.js';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function appleSecret(){
 const client=Deno.env.get('APPLE_CLIENT_ID')||'au.jpollak.journey',team=Deno.env.get('APPLE_TEAM_ID'),kid=Deno.env.get('APPLE_KEY_ID'),pem=Deno.env.get('APPLE_PRIVATE_KEY');
 if(!team||!kid||!pem)throw new Error('Apple revocation configuration missing');
 const key=await importPKCS8(pem.replace(/\\n/g,'\n'),'ES256');
 return {client,secret:await new SignJWT({}).setProtectedHeader({alg:'ES256',kid}).setIssuer(team).setSubject(client).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key)};
}
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
 const caller=createClient(url,key,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const {data,error}=await caller.auth.getUser();if(error||!data.user)return reply({error:'Recent sign-in required'},401);
  const owner=data.user.id,body=await boundedJSON(request,20000);
  const {data:budget}=await admin.rpc('consume_operation',{p_key:`account:${owner}`,p_max:20});if(!budget)return reply({error:'Please retry later'},429);
  if(body.action==='captureAppleAuthorization'){
   if(typeof body.code!=='string'||body.code.length>4000||!data.user.identities?.some(i=>i.provider==='apple'))return reply({error:'Apple identity required'},400);
   const encryption=Deno.env.get('ACCOUNT_CREDENTIAL_KEY');if(!encryption)return reply({error:'Secure Apple revocation storage is not configured'},503);
   const apple=await appleSecret();
   const response=await fetch('https://appleid.apple.com/auth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:apple.client,client_secret:apple.secret,grant_type:'authorization_code',code:body.code})});
   const tokens=await response.json();if(!response.ok||!tokens.refresh_token||!tokens.id_token)return reply({error:'Apple authorization must be renewed'},400);
   const verified=await jwtVerify(tokens.id_token,createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),{issuer:'https://appleid.apple.com',audience:apple.client});
   const subject=data.user.identities.find(i=>i.provider==='apple')?.identity_data?.sub;
   if(!subject||verified.payload.sub!==subject)return reply({error:'Apple account mismatch'},403);
   const ciphertext=await sealCredentials({refresh_token:tokens.refresh_token},encryption,owner,'apple');
   const {error:saveError}=await admin.from('provider_credentials').upsert({owner_id:owner,provider:'apple',ciphertext});if(saveError)throw saveError;
   return reply({stored:true});
  }
  if(body.action!=='delete'||body.confirmation!=='DELETE')return reply({error:'Explicit deletion confirmation required'},400);
  // getUser verified this JWT. Inspect its authentication method timestamp, not just token refresh time.
  const encoded=(request.headers.get('Authorization')||'').replace(/^Bearer /i,'').split('.')[1];
  const claims=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));
  const recent=(claims.amr||[]).some((entry:{timestamp:number})=>entry.timestamp>Date.now()/1000-600);
  if(!recent)return reply({error:'Sign in again before deleting your account'},428);
  // Validate cleanup prerequisites before revoking providers or freezing the account.
  const required=['R2_REGION','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'];
  if(required.some(name=>!Deno.env.get(name)))return reply({error:'Private media cleanup configuration is incomplete'},503);
  const {data:services,error:serviceError}=await admin.from('connected_services').select('provider,status').eq('owner_id',owner);if(serviceError)throw serviceError;
  // Tesla's documented consent revocation is interactive. Do not delete an account while live Tesla consent remains.
  const {data:teslaCredentials,error:teslaError}=await admin.from('provider_credentials').select('provider').eq('owner_id',owner).eq('provider','tesla');if(teslaError)throw teslaError;
  if(teslaCredentials?.length||services?.some(s=>s.provider==='tesla'&&s.status==='connected'))return reply({error:'Revoke Tesla consent in Garage and disconnect before retrying account deletion'},409);
  if(data.user.identities?.some(i=>i.provider==='apple')){
   const {data:credential,error}=await admin.from('provider_credentials').select('ciphertext').eq('owner_id',owner).eq('provider','apple').maybeSingle();
   if(error||!credential||!Deno.env.get('ACCOUNT_CREDENTIAL_KEY'))return reply({error:'Sign in with Apple again to prepare token revocation before deletion'},409);
   const tokens=await openCredentials(credential.ciphertext,Deno.env.get('ACCOUNT_CREDENTIAL_KEY')!,owner,'apple');const apple=await appleSecret();
   const revoked=await fetch('https://appleid.apple.com/auth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:apple.client,client_secret:apple.secret,token:tokens.refresh_token,token_type_hint:'refresh_token'})});
   if(!revoked.ok)return reply({error:'Apple revocation could not be completed. Account retained; retry later.'},503);
  }
  const {error:freeze}=await admin.from('account_deletion_requests').upsert({owner_id:owner});if(freeze)throw freeze;
  const {error:unpublished}=await admin.from('shared_journeys').delete().eq('owner_id',owner);if(unpublished)throw unpublished;
  const {error:marked}=await admin.auth.admin.updateUserById(owner,{app_metadata:{...data.user.app_metadata,deletion_requested:true}});if(marked)throw marked;
  // All application media keys are owner-prefixed. List the private prefix so paginated
  // PostgREST defaults cannot leave images beyond the first 1,000 rows behind.
  const r2=new S3Client({region:Deno.env.get('R2_REGION'),endpoint:Deno.env.get('R2_ENDPOINT'),credentials:{accessKeyId:Deno.env.get('R2_ACCESS_KEY_ID')!,secretAccessKey:Deno.env.get('R2_SECRET_ACCESS_KEY')!}});
  for(let batch=0;batch<10;batch++){
   const listed=await r2.send(new ListObjectsV2Command({Bucket:Deno.env.get('R2_BUCKET_NAME'),Prefix:`${owner}/`,MaxKeys:1000}));
   const objects=(listed.Contents||[]).flatMap(object=>object.Key?[{Key:object.Key}]:[]);
   if(!objects.length)break;
   const result=await r2.send(new DeleteObjectsCommand({Bucket:Deno.env.get('R2_BUCKET_NAME'),Delete:{Objects:objects}}));
   if(result.Errors?.length)return reply({error:'Some private media could not be removed. Retry deletion.'},503);
   if(batch===9)return reply({pending:true,error:'Media cleanup is in progress. Retry to finish account deletion.'},202);
  }
  // Runs after the freeze above, so no new photo can arrive behind this listing.
  try{await removeFeedbackObjects(admin.storage,owner);}
  catch{return reply({error:'Some private media could not be removed. Retry deletion.'},503);}
  const {error:deleted}=await admin.auth.admin.deleteUser(owner,false);if(deleted)throw deleted;
  const {error:cleanup}=await admin.from('media_cleanup').delete().like('object_key',`${owner}/%`);if(cleanup)return reply({deleted:true,cleanupPending:true});
  return reply({deleted:true});
 }catch(error){console.error('Account operation failed',error instanceof Error?error.name:'unknown');return reply({error:'Account operation could not be completed; retry or contact support'},500);}
});
