// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {makeHandler} from './worker.js';
import {validateAssets,validatePublicKey} from './validate.mjs';
const keyPath='/.well-known/appspecific/com.tesla.3p.public-key.pem';
const callback='https://letm3go.au/auth/tesla/callback';
const state='a'.repeat(64);
const pair=(curve='prime256v1')=>generateKeyPairSync('ec',{namedCurve:curve});
const pem=pair().publicKey.export({type:'spki',format:'pem'});
const assets={ASSETS:{fetch:vi.fn(async request=>new Response(new URL(request.url).pathname===keyPath?pem:'<!doctype html><h1>Letm3go</h1>',{headers:{'Content-Type':'text/html'}}))}};
it('serves raw public PEM with security headers and no redirect',async()=>{
 const result=await makeHandler()(new Request('https://letm3go.au'+keyPath),assets);
 expect(result.status).toBe(200);expect(result.headers.get('Content-Type')).toBe('application/x-pem-file');expect(await result.text()).toBe(pem);expect(result.headers.has('Location')).toBe(false);
 expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
});
it('fails closed for a missing key and never serves the landing page as PEM',async()=>{
 const result=await makeHandler()(new Request('https://letm3go.au'+keyPath),{ASSETS:{fetch:async()=>new Response('landing',{status:404})}});
 expect(result.status).toBe(503);expect(await result.text()).not.toContain('<h1>');
});
it('serves the landing page and rejects arbitrary paths without SPA fallback',async()=>{
 expect((await makeHandler()(new Request('https://letm3go.au/'),assets)).status).toBe(200);
 expect((await makeHandler()(new Request('https://letm3go.au/.env.local'),assets)).status).toBe(404);
});
it('redirects HTTP and www to HTTPS apex without forwarding sensitive query parameters',async()=>{
 for(const url of ['http://letm3go.au/','https://www.letm3go.au/']){
  const result=await makeHandler()(new Request(url+'?code=do-not-forward'),assets);
  expect(result.status).toBe(308);expect(result.headers.get('Location')).toBe('https://letm3go.au/');
 }
});
it('does not forward invalid or insecure callbacks or claim success',async()=>{
 const backend=vi.fn();const handler=makeHandler(backend);
 for(const url of [callback,callback+'?code=secret',callback+'?state='+state+'&code=x&code=y',callback+'?state='+state+'&code=x&error=y',callback.replace('https:','http:')+'?state='+state+'&code=x']){
  const result=await handler(new Request(url),assets);expect(result.status).toBe(400);expect(await result.text()).not.toContain('secret');
 }
 expect(backend).not.toHaveBeenCalled();
});
it('forwards only state and code to the fixed backend, returning only its verified status to iOS',async()=>{
 const backend=vi.fn(async()=>new Response(null,{status:302,headers:{Location:'au.jpollak.journey://tesla/connected?status=connected'}}));
 const result=await makeHandler(backend)(new Request(callback+'?state='+state+'&code=one-time-code&untrusted=drop',{headers:{Cookie:'private',Authorization:'private'}}),assets);
 expect(result.status).toBe(302);expect(result.headers.get('Location')).toBe('au.jpollak.journey://tesla/connected?status=connected');expect(result.headers.get('Cache-Control')).toBe('no-store');expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
 const [target,options]=backend.mock.calls[0];expect(new URL(target).origin).toBe('https://subobfmlkfqcsaekygat.supabase.co');expect(new URL(target).searchParams.size).toBe(2);expect(options.redirect).toBe('manual');expect(options.headers).toEqual({Accept:'application/json'});
});
it('preserves cancellation and rejects unexpected backend redirects or token-bearing replies',async()=>{
 for(const next of ['https://evil.example/','au.jpollak.journey://tesla/connected?status=connected&token=private']){
  const response=await makeHandler(async()=>new Response(null,{status:302,headers:{Location:next}}))(new Request(callback+'?state='+state+'&code=x'),assets);expect(response.status).toBe(502);
 }
 const backend=vi.fn(async()=>new Response(null,{status:302,headers:{Location:'au.jpollak.journey://tesla/connected?status=cancelled'}}));
 const response=await makeHandler(backend)(new Request(callback+'?state='+state+'&error=access_denied'),assets);expect(response.headers.get('Location')).toContain('status=cancelled');expect(new URL(backend.mock.calls[0][0]).searchParams.has('code')).toBe(false);
});
it('rejects unsupported methods and blocks unknown hosts',async()=>{
 expect((await makeHandler()(new Request('https://letm3go.au/',{method:'POST'}),assets)).status).toBe(405);
 expect((await makeHandler()(new Request('https://untrusted.example/'),assets)).status).toBe(421);
});
it('accepts only public P-256 keys, never private keys or a different curve',()=>{
 expect(()=>validatePublicKey(pem)).not.toThrow();expect(()=>validatePublicKey(pair('secp384r1').publicKey.export({type:'spki',format:'pem'}))).toThrow();expect(()=>validatePublicKey(pair().privateKey.export({type:'pkcs8',format:'pem'}))).toThrow();
});
it('deployment validation rejects missing keys, extra files and private key material',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'letm3go-public-assets-'));
 try{
  await mkdir(path.join(dir,'.well-known/appspecific'),{recursive:true});
  await expect(validateAssets(dir)).rejects.toThrow();
  await writeFile(path.join(dir,keyPath.slice(1)),pem);await expect(validateAssets(dir)).resolves.toBeUndefined();
  await writeFile(path.join(dir,'unexpected.env'),'secret');await expect(validateAssets(dir)).rejects.toThrow();
  await rm(path.join(dir,'unexpected.env'));await writeFile(path.join(dir,'index.html'),pair().privateKey.export({type:'pkcs8',format:'pem'}));await expect(validateAssets(dir)).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
