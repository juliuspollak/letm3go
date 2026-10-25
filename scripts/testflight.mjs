import { readFileSync,lstatSync,mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPrivateKey,sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function releaseEnvironment(directory,inherited=process.env){
 const allowed=['APPLE_TEAM_ID','APP_STORE_CONNECT_API_KEY_ID','APP_STORE_CONNECT_ISSUER_ID','APP_STORE_CONNECT_API_KEY_BASE64','APP_STORE_CONNECT_API_KEY_PATH','PROFILE_NAME','PROFILE_UUID'];
 let local={};const file=path.join(directory,'.env.testflight.local');
 try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o7777)!==0o600||stat.uid!==process.getuid())throw new Error('Release credential file must be owned, regular and mode 0600.');local=parseEnv(readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(Object.keys(local).some(key=>!allowed.includes(key)))throw new Error('Unsupported key in release credential file.');
 const env={...inherited};for(const key of allowed)if(!env[key]&&local[key])env[key]=local[key];
 if(!env.APP_STORE_CONNECT_API_KEY_BASE64&&env.APP_STORE_CONNECT_API_KEY_PATH){const p=env.APP_STORE_CONNECT_API_KEY_PATH,stat=lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o7777)!==0o600||stat.uid!==process.getuid())throw new Error('Apple private key must be owned, regular and mode 0600.');env.APP_STORE_CONNECT_API_KEY_BASE64=readFileSync(p).toString('base64');}
 for(const key of ['APP_STORE_CONNECT_API_KEY_ID','APP_STORE_CONNECT_ISSUER_ID','APP_STORE_CONNECT_API_KEY_BASE64'])if(!env[key]?.trim())throw new Error(`Missing ${key}. Configure .env.testflight.local; no interactive Apple login will be started.`);
 return env;
}
export async function preflight(env,fetchImpl=fetch){
 let key;try{key=createPrivateKey(Buffer.from(env.APP_STORE_CONNECT_API_KEY_BASE64,'base64'));if(key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw new Error();}catch{throw new Error('App Store Connect key must be a valid P-256 private key.');}
 const now=Math.floor(Date.now()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const body=`${encode({alg:'ES256',kid:env.APP_STORE_CONNECT_API_KEY_ID,typ:'JWT'})}.${encode({iss:env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'})}`;
 const jwt=`${body}.${sign('sha256',Buffer.from(body),{key,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
 async function get(endpoint){const response=await fetchImpl(`https://api.appstoreconnect.apple.com/v1/${endpoint}`,{headers:{Authorization:`Bearer ${jwt}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`App Store Connect read-only check failed: HTTP ${response.status}.`);return response.json();}
 const apps=await get('apps?filter%5BbundleId%5D=au.jpollak.journey&limit=2');if(apps.data?.length!==1)throw new Error('The API key cannot find exactly one Letm3go app record.');
 const app=apps.data[0];if(app.attributes.bundleId!=='au.jpollak.journey')throw new Error('Unexpected Apple bundle identifier.');const builds=await get(`builds?filter%5Bapp%5D=${encodeURIComponent(app.id)}&sort=-uploadedDate&limit=10&include=preReleaseVersion`);
 return {appID:app.id,bundleID:app.attributes.bundleId,name:app.attributes.name,builds:(builds.data||[]).map(b=>({build:b.attributes.version,state:b.attributes.processingState})),verifiedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const action=process.argv[2];if(!['preflight','package'].includes(action))throw new Error('Usage: node scripts/testflight.mjs preflight|package. This wrapper never uploads.');const env=releaseEnvironment(root);if(!env.BUNDLE_PATH&&existsSync(path.join(root,'.build/bundle')))env.BUNDLE_PATH=path.join(root,'.build/bundle');env.FASTLANE_OPT_OUT_USAGE='1';env.FASTLANE_SKIP_UPDATE_CHECK='1';const report=await preflight(env);mkdirSync(path.join(root,'.build/release'),{recursive:true});writeFileSync(path.join(root,'.build/release/app-store-preflight.json'),JSON.stringify(report,null,2));console.log('App Store Connect authentication and Letm3go app record verified. Safe report: .build/release/app-store-preflight.json');if(action==='package'){const result=spawnSync('bundle',['exec','fastlane','ios','package'],{cwd:root,env,stdio:'inherit'});process.exitCode=result.status??1;}}catch(error){console.error(error.code?'Release preflight could not read local configuration.':error.message);process.exitCode=1;}
}
