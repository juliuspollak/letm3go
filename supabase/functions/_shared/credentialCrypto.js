const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const base64=data=>btoa(Array.from(data,c=>String.fromCharCode(c)).join(''));
export async function sealCredentials(value,keyText,owner,provider,cryptoImpl=crypto){
 const key=await cryptoImpl.subtle.importKey('raw',bytes(keyText),'AES-GCM',false,['encrypt']);
 const iv=cryptoImpl.getRandomValues(new Uint8Array(12));
 const encrypted=new Uint8Array(await cryptoImpl.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`${owner}:${provider}`)},key,new TextEncoder().encode(JSON.stringify(value))));
 return `${base64(iv)}.${base64(encrypted)}`;
}
export async function openCredentials(value,keyText,owner,provider,cryptoImpl=crypto){
 const [iv,encrypted]=value.split('.');
 const key=await cryptoImpl.subtle.importKey('raw',bytes(keyText),'AES-GCM',false,['decrypt']);
 const decrypted=await cryptoImpl.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(`${owner}:${provider}`)},key,bytes(encrypted));
 return JSON.parse(new TextDecoder().decode(decrypted));
}
