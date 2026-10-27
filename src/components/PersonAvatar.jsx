import {useEffect,useState} from 'react';

// One presentation component for household, friends and Home. The caller controls
// which images it is authorised to access; this component never fetches private media.
export default function PersonAvatar({name='',src=null,size='md',className=''}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>{queueMicrotask(()=>setFailed(false));},[src]);
 const initial=(typeof name==='string'&&name.trim()?name.trim()[0]:'?').toLocaleUpperCase();
 const image=typeof src==='string'&&(src.startsWith('data:image/jpeg;base64,')||src.startsWith('data:image/png;base64,')||src.startsWith('blob:')||src.startsWith('https://'));
 return <span className={`person-avatar person-avatar--${size} ${className}`} role="img" aria-label={`${name||'Person'} avatar`}>
  {image&&!failed?<img src={src} alt="" onError={()=>setFailed(true)}/>:<span aria-hidden="true">{initial}</span>}
 </span>;
}
