import { useEffect, useState } from 'react';
import { resolvePhoto } from '../lib/privateMedia.js';
export default function PrivateImage({src,alt='',...props}){
 const [loaded,setLoaded]=useState(null);
 useEffect(()=>{let alive=true;resolvePhoto(src).then(url=>{if(alive)setLoaded({src,url});}).catch(()=>{if(alive)setLoaded({src,url:null});});return()=>{alive=false;};},[src]);
 if(src?.startsWith('private-photo:'))return loaded?.src===src&&loaded.url?<img {...props} src={loaded.url} alt={alt}/>:<span className="photo-unavailable">{alt||'Private photo'}</span>;
 return <img {...props} src={src} alt={alt}/>;
}
