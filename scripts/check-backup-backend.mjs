import {readFileSync} from 'node:fs';
import {loadEnv} from 'vite';
import {validateRelease} from './check-release.mjs';

// Verify RPC resolution without a user token or a write. The anonymous role must
// resolve the five-argument endpoint and then be denied EXECUTE by PostgreSQL.
export async function checkBackupBackend(env,fetchImpl=fetch){
 const response=await fetchImpl(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/backup_private_activity`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({p_owner:null,p_payload:{},p_fingerprint:'0'.repeat(64),p_expected_revision:null,p_base_fingerprint:null}),
 });
 const result=await response.json();
 if(![401,403].includes(response.status)||result.code!=='42501'||!/permission denied for function backup_private_activity/i.test(result.message||'')){
  throw new Error('Required backup-content RPC is not verified. Apply 20261210000000 before releasing this client.');
 }
 return true;
}
if(!process.env.VITEST){
 try{
  const env=loadEnv('production',process.cwd(),'');
  validateRelease(env,JSON.parse(readFileSync('capacitor.config.json','utf8')));
  await checkBackupBackend(env);
  console.log('Backup-content RPC signature and anonymous access denial verified.');
 }catch(error){
  console.error(error.message.startsWith('Required backup-content')?error.message:'Backup backend verification failed; no release should be uploaded.');
  process.exitCode=1;
 }
}
