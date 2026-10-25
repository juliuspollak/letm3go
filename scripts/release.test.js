// @vitest-environment node
import { mkdtempSync,writeFileSync,chmodSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach,it,expect,vi } from 'vitest';
import { releaseEnvironment,preflight } from './testflight.mjs';
import { validateRelease } from './check-release.mjs';
const directories=[];
afterEach(()=>{for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});
function fixture(){const d=mkdtempSync(path.join(tmpdir(),'letm3go-release-'));directories.push(d);return d;}
it('fails closed without Apple credentials and securely loads dedicated configuration',()=>{const d=fixture();expect(()=>releaseEnvironment(d,{})).toThrow('Missing APP_STORE_CONNECT_API_KEY_ID');const p=path.join(d,'.env.testflight.local');writeFileSync(p,'APP_STORE_CONNECT_API_KEY_ID=example\nAPP_STORE_CONNECT_ISSUER_ID=example\nAPP_STORE_CONNECT_API_KEY_BASE64=example\n',{mode:0o600});expect(releaseEnvironment(d,{}).APP_STORE_CONNECT_API_KEY_ID).toBe('example');chmodSync(p,0o644);expect(()=>releaseEnvironment(d,{})).toThrow('0600');});
it('verifies the exact bundle through read-only Apple API calls without exporting the JWT',async()=>{const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const env={APP_STORE_CONNECT_API_KEY_ID:'test',APP_STORE_CONNECT_ISSUER_ID:'test',APP_STORE_CONNECT_API_KEY_BASE64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({data:[{id:'app',attributes:{name:'Letm3go',bundleId:'au.jpollak.journey'}}]})}).mockResolvedValueOnce({ok:true,json:async()=>({data:[]})});const report=await preflight(env,fetchImpl);expect(report.bundleID).toBe('au.jpollak.journey');expect(fetchImpl.mock.calls.every(([url,options])=>url.startsWith('https://api.appstoreconnect.apple.com/v1/')&&!options.method)).toBe(true);expect(JSON.stringify(report)).not.toContain('Bearer');});
it('rejects localhost, wrong projects, secret keys, development servers and demo flags in Release',()=>{const env={VITE_SUPABASE_URL:'https://subobfmlkfqcsaekygat.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},cap={appId:'au.jpollak.journey',webDir:'dist'};expect(()=>validateRelease(env,cap)).not.toThrow();expect(()=>validateRelease({...env,VITE_SUPABASE_URL:'http://localhost:54321'},cap)).toThrow();expect(()=>validateRelease({...env,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'},cap)).toThrow();expect(()=>validateRelease(env,{...cap,server:{url:'http://localhost:5173'}})).toThrow();expect(()=>validateRelease({...env,VITE_ENABLE_DEMO:'true'},cap)).toThrow();});
