import {readFile,readdir} from 'node:fs/promises';
import {createPublicKey} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('./public/',import.meta.url));
export function validatePublicKey(pem){
 if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem))throw new Error('Expected a single public-key PEM.');
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw new Error('Tesla requires a prime256v1 public key.');
 return key;
}
export async function validateAssets(directory=root){
 const expected=new Set(['index.html','styles.css','brand.svg','favicon.svg','robots.txt','.well-known/appspecific/com.tesla.3p.public-key.pem']);
 async function walk(base,prefix=''){
  for(const item of await readdir(base,{withFileTypes:true})){
   if(item.isSymbolicLink())throw new Error('Symlinks are forbidden in website assets.');
   const relative=prefix+item.name;
   if(item.isDirectory()){if(!['.well-known','.well-known/appspecific'].includes(relative))throw new Error('Unexpected asset directory.');await walk(path.join(base,item.name),relative+'/');continue;}
   if(!expected.has(relative))throw new Error('Unexpected website asset: deployment blocked.');
   const data=await readFile(path.join(base,item.name),'utf8');
   if(/-----BEGIN (?:EC |RSA |ENCRYPTED )?PRIVATE KEY-----|SUPABASE_ACCESS_TOKEN\s*=|APP_STORE_CONNECT_API_KEY\s*=|sb_secret_|sbp_[A-Za-z0-9]{20}/.test(data))throw new Error('Sensitive content detected: deployment blocked.');
  }
 }
 await walk(directory);
 const pem=await readFile(path.join(directory,'.well-known/appspecific/com.tesla.3p.public-key.pem'),'utf8').catch(()=>{throw new Error('Tesla public key missing. Follow docs/website-cloudflare.md; no placeholder key is allowed.');});
 validatePublicKey(pem);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await validateAssets();console.log('Website asset allowlist and Tesla P-256 public key validated.');}catch{console.error('Website validation failed. Ensure only approved public assets and a valid Tesla P-256 public key exist in website/public. See docs/website-cloudflare.md.');process.exitCode=1;}
}
