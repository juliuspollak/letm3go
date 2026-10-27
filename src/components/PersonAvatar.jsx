import {useState} from 'react';
import {isAvatarImage,resolveAvatar} from '../lib/avatar.js';

// One presentation component for household, friends, Home and the header. The
// caller controls which images it is authorised to access; this component never
// fetches private media. Passing `selfId` guarantees the signed-in user resolves
// to their own photo by stable id instead of an initial.
export default function PersonAvatar({name='',src=null,userId=null,selfId=null,photos=null,selfAvatar=null,size='md',className=''}){
 // Tracking the failed source (rather than a boolean) means a new photo retries
 // automatically, so a profile update propagates to every screen.
 const [failedSrc,setFailedSrc]=useState(null);
 const resolved=src&&isAvatarImage(src)?{src,initial:resolveAvatar({name}).initial}:resolveAvatar({userId,selfId,photos:photos||{},selfAvatar,name});
 const image=resolved.src;
 const failed=Boolean(image)&&failedSrc===image;
 return <span className={`person-avatar person-avatar--${size}${className?` ${className}`:''}`} role="img" aria-label={`${name||'Person'} avatar`}>
  {image&&!failed?<img key={image} src={image} alt="" decoding="async" onError={()=>setFailedSrc(image)}/>:<span className="person-avatar-initial" aria-hidden="true">{resolved.initial}</span>}
 </span>;
}


