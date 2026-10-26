import { readFileSync,existsSync } from 'node:fs';
import { loadEnv } from 'vite';
export function validateAppIcon(file='ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'){
 const png=readFileSync(file);
 if(png.length<33||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR')throw new Error('iOS AppIcon must be a valid PNG.');
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20),colourType=png[25];
 if(width!==1024||height!==1024)throw new Error(`iOS AppIcon must be 1024x1024; found ${width}x${height}. Resize AppIcon-512@2x.png before releasing.`);
 if(colourType===4||colourType===6)throw new Error('iOS AppIcon must not include an alpha channel. Export an opaque RGB PNG.');
}
export function validateRelease(env,capacitor){
 if(env.VITE_SUPABASE_URL!=='https://subobfmlkfqcsaekygat.supabase.co')throw new Error('Release must use the verified Letm3go Supabase project.');
 const key=env.VITE_SUPABASE_PUBLISHABLE_KEY||'';let publicKey=key.startsWith('sb_publishable_');try{publicKey||=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon';}catch{/* Not a legacy anon JWT. */}
 if(!publicKey)throw new Error('Release needs a public publishable/anon key, never a backend credential.');
 if(capacitor.appId!=='au.jpollak.journey'||capacitor.webDir!=='dist'||capacitor.server)throw new Error('Release must bundle dist locally with the Letm3go identifier and no development server.');
 for(const key of ['VITE_ENABLE_DEMO','VITE_USE_MOCKS','VITE_ENABLE_PUSH'])if(env[key]==='true')throw new Error(`Unsupported release flag: ${key}`);
 for(const key of ['CAPACITOR_SERVER_URL','VITE_DEV_SERVER_URL'])if(env[key])throw new Error('Development server overrides cannot be used in Release.');
}
if(!process.env.VITEST){try{const env=loadEnv('production',process.cwd(),'');validateRelease(env,JSON.parse(readFileSync('capacitor.config.json','utf8')));validateAppIcon();if(process.argv.includes('--synced')){if(!existsSync('ios/App/App/public/index.html'))throw new Error('Synced assets are missing.');validateRelease(env,JSON.parse(readFileSync('ios/App/App/capacitor.config.json','utf8')));}console.log('Release project, public backend configuration and bundled-server checks passed.');}catch(error){console.error(error.message);process.exitCode=1;}}
