import {useEffect,useState} from 'react';
import BrandMark from './BrandMark.jsx';

// Render each animated variation as a single inline word, never as overlapping
// independently animated width containers. The full name remains the default.
const variations=[
 {text:'letm3go',duration:5300},
 {text:'lines',duration:1500},
 {text:'let',duration:1700},
 {text:'letgo',duration:2300},
 {text:'letm3go',duration:4400},
 {text:'lines',duration:1400},
 {text:'letm3',duration:1900},
 {text:'let3go',duration:2200},
 {text:'letm3go',duration:6500}
];
export default function AnimatedWordmark(){
 const [index,setIndex]=useState(0);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const preference=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
  let timeout,current=0;
  const step=()=>{current=(current+1)%variations.length;setIndex(current);timeout=window.setTimeout(step,variations[current].duration);};
  const restart=()=>{window.clearTimeout(timeout);current=0;setIndex(0);if(!preference.matches)timeout=window.setTimeout(step,variations[0].duration);};
  restart();preference.addEventListener?.('change',restart);
  return()=>{window.clearTimeout(timeout);preference.removeEventListener?.('change',restart);};
 },[]);
 const value=variations[index].text;
 return <span className="animated-wordmark stable-wordmark" role="img" aria-label="letm3go">
  <span className="stable-wordmark-inner" aria-hidden="true" key={value}>
   {value==='lines'?<span className="stable-wordmark-lines"><svg viewBox="0 0 32 32" fill="none"><path d="M6 8h20M6 16h20M6 24h20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></span>:<>
    {Array.from(value).map((letter,i)=><span key={i} className={letter==='3'?'stable-wordmark-accent':undefined}>{letter}</span>)}
    {value==='letm3go'&&<span className="stable-wordmark-arrow"><BrandMark/></span>}
   </>}
  </span>
 </span>;
}
