import {useEffect,useState} from 'react';
import BrandMark from './BrandMark.jsx';

// Start with the original full logo, collapse into its three-line mark,
// and only then play with the name. Always return to the full identity.
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
 const value=variations[index].text,lines=value==='lines',hasM=value.includes('m'),has3=value.includes('3'),hasGo=value.endsWith('go');
 return <span className="animated-wordmark playful-wordmark" role="img" aria-label="letm3go"><span className="wordmark-motion" aria-hidden="true"><span className={`playful-part playful-let ${!lines?'is-shown':''}`}>let</span><span className={`playful-part playful-m ${hasM?'is-shown':''}`}>m</span><span className={`playful-core ${has3||lines?'is-shown':''}`}><span className={`playful-core-digit ${has3?'is-shown':''}`}>3</span><svg className={`playful-core-lines ${lines?'is-shown':''}`} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 8h20M6 16h20M6 24h20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></span><span className={`playful-part playful-go ${hasGo?'is-shown':''}`}>go</span><span className={`playful-part playful-arrow ${value==='letm3go'?'is-shown':''}`}><BrandMark/></span></span></span>;
}
