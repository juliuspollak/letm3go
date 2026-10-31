// crypto.randomUUID needs iOS 15.4 and a secure context; the app supports iOS 15.0.
// getRandomValues exists on every supported version. Math.random is only the last
// resort for an environment with no crypto at all.
export function newUUID(){
 const crypto=globalThis.crypto;
 if(crypto?.randomUUID)return crypto.randomUUID();
 const bytes=new Uint8Array(16);
 if(crypto?.getRandomValues)crypto.getRandomValues(bytes);
 else for(let i=0;i<16;i++)bytes[i]=Math.random()*256|0;
 bytes[6]=bytes[6]&0x0f|0x40;
 bytes[8]=bytes[8]&0x3f|0x80;
 const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
