// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {checkBackupBackend} from './check-backup-backend.mjs';
const env={VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'public-fixture'};
it('verifies the new signature using only an anonymous denied call and no activity data',async()=>{
 const fetch=vi.fn().mockResolvedValue({status:401,json:async()=>({code:'42501',message:'permission denied for function backup_private_activity'})});
 await expect(checkBackupBackend(env,fetch)).resolves.toBe(true);
 const [,request]=fetch.mock.calls[0];expect(JSON.parse(request.body)).toMatchObject({p_owner:null,p_payload:{},p_base_fingerprint:null});
 expect(request.headers.Authorization).toBeUndefined();expect(request.redirect).toBe('error');
});
it('blocks release if the migration is missing, access is too broad, or authentication cannot be checked',async()=>{
 for(const [status,payload] of [[404,{code:'PGRST202'}],[200,1],[401,{code:'invalid_api_key'}],[500,{code:'XX000'}]]){
  await expect(checkBackupBackend(env,async()=>({status,json:async()=>payload}))).rejects.toThrow('not verified');
 }
});
