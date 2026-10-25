import {lstat,readFile,writeFile} from 'node:fs/promises';
import {validatePublicKey} from './validate.mjs';
try{
 const source=process.argv[2];if(!source)throw new Error();
 const meta=await lstat(source);if(!meta.isFile()||meta.isSymbolicLink()||meta.size>4096)throw new Error();
 const pem=await readFile(source,'utf8');validatePublicKey(pem);
 await writeFile(new URL('./public/.well-known/appspecific/com.tesla.3p.public-key.pem',import.meta.url),pem,{mode:0o644});
 console.log('Validated Tesla P-256 public key installed. No private key was read or copied.');
}catch{console.error('Public-key installation failed. Supply a regular public-key-only P-256 PEM file.');process.exitCode=1;}
