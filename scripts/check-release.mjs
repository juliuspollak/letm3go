import { readFileSync,existsSync } from 'node:fs';
import { loadEnv } from 'vite';
export function validateRelease(env,capacitor){
 if(env.VITE_SUPABASE_URL!=='https://subobfmlkfqcsaekygat.supabase.co')throw new Error('Release must use the verified Letm3go Supabase project.');
 const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||'';let publicKey=key.startsWith('sb_publishable_');try{publicKey||=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon';}catch{/* Not a legacy anon JWT. */}
 if(!publicKey)throw new Error('Release needs a public publishable/anon key, never a backend credential.');
 if(capacitor.appId!=='au.jpollak.journey'||capacitor.webDir!=='dist'||capacitor.server)throw new Error('Release must bundle dist locally with the Letm3go identifier and no development server.');
 for(const key of ['VITE_ENABLE_DEMO','VITE_USE_MOCKS','VITE_ENABLE_PUSH'])if(env[key]==='true')throw new Error(`Unsupported release flag: ${key}`);
 for(const key of ['CAPACITOR_SERVER_URL','VITE_DEV_SERVER_URL'])if(env[key])throw new Error('Development server overrides cannot be used in Release.');
}
if(!process.env.VITEST){try{const env=loadEnv('production',process.cwd(),'');validateRelease(env,JSON.parse(readFileSync('capacitor.config.json','utf8')));if(process.argv.includes('--synced')){if(!existsSync('ios/App/App/public/index.html'))throw new Error('Synced assets are missing.');validateRelease(env,JSON.parse(readFileSync('ios/App/App/capacitor.config.json','utf8')));}console.log('Release project, public backend configuration and bundled-server checks passed.');}catch(error){console.error(error.message);process.exitCode=1;}}
