// One avatar resolver for the whole app. A person is always matched by their
// stable user id: never by display name, household role or list position.
const DATA_IMAGE=/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i;
const JPEG_IMAGE=/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/i;
const REMOTE_IMAGE=/^(?:https:\/\/|blob:)/i;
// Matches the household_member_avatars check constraint (180 KB of base64).
export const AVATAR_LIMIT=180000;

export function isAvatarImage(value){
 if(typeof value!=='string')return false;
 const source=value.trim();
 return source.length>12&&(DATA_IMAGE.test(source)||REMOTE_IMAGE.test(source));
}

// Initials are only ever a fallback for a person without a usable image.
export function avatarInitial(name){
 return typeof name==='string'&&name.trim()?name.trim()[0].toLocaleUpperCase():'?';
}

// `selfAvatar` wins for the signed-in user because local preferences are always
// the freshest copy; `photos` covers everyone else (and still resolves self when
// preferences have not loaded yet). Lookups stay case-insensitive because ids
// arrive from both Postgres and the native recorder with mixed casing.
export function resolveAvatar({userId=null,selfId=null,photos={},selfAvatar=null,name=''}={}){
 const own=Boolean(userId)&&Boolean(selfId)&&String(userId).toLowerCase()===String(selfId).toLowerCase();
 const shared=lookupPhoto(photos,userId);
 const source=(own?[selfAvatar,shared]:[shared]).find(isAvatarImage)||null;
 return {src:source,initial:avatarInitial(name),own};
}

function lookupPhoto(photos,userId){
 if(!photos||userId==null)return null;
 const key=String(userId);
 if(typeof photos[key]==='string')return photos[key];
 const match=Object.keys(photos).find(candidate=>candidate.toLowerCase()===key.toLowerCase());
 return match?photos[match]:null;
}


export function avatarNeedsConversion(value){
 return isAvatarImage(value)&&!JPEG_IMAGE.test(value.trim());
}

// Photos are stored as 256 px JPEG data URLs. Older accounts (or a restored
// backup) can hold a PNG or an oversized image, which must never silently fail
// the shared-avatar upload and hide everyone's photo.
export async function shareableAvatar(value){
 if(!isAvatarImage(value))return null;
 const source=value.trim();
 if(JPEG_IMAGE.test(source)&&source.length<=AVATAR_LIMIT)return source;
 if(typeof document==='undefined'||typeof document.createElement!=='function')return null;
 try{
  // Fail fast where a 2D canvas is unavailable instead of waiting on a decode.
  const canvas=document.createElement('canvas');
  canvas.width=256;canvas.height=256;
  const context=canvas.getContext?.('2d');
  if(!context)return null;
  const image=await loadImage(source);
  if(!image)return null;
  context.drawImage(image,0,0,256,256);
  const jpeg=canvas.toDataURL?.('image/jpeg',0.8);
  return typeof jpeg==='string'&&JPEG_IMAGE.test(jpeg)&&jpeg.length<=AVATAR_LIMIT?jpeg:null;
 }catch{return null;}
}

function loadImage(source){
 return new Promise(resolve=>{
  const image=new Image();
  const done=result=>{window.clearTimeout(timer);resolve(result);};
  const timer=window.setTimeout(()=>done(null),5000);
  image.onload=()=>done(image);
  image.onerror=()=>done(null);
  image.src=source;
 });
}
