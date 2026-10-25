import {useEffect,useState} from 'react';
import BrandMark from './BrandMark.jsx';

// The original mark always returns between brief playful variations.
const variations=[
 {text:'letm3go',duration:5500},
 {text:'let',duration:1550},
 {text:'letgo',duration:2050},
 {text:'letm3go',duration:3600},
 {text:'letm3',duration:1850},
 {text:'let3go',duration:1900},
 {text:'letm3go',duration:6000},
];
export default function AnimatedWordmark(){
 const [index,setIndex]=useState(0);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let timeout;
  let current=0;
  const step=()=>{current=(current+1)%variations.length;setIndex(current);timeout=window.setTimeout(step,variations[current].duration);};
  const restart=()=>{window.clearTimeout(timeout);current=0;setIndex(0);if(!preference.matches)timeout=window.setTimeout(step,variations[0].duration);};
  restart();
  preference.addEventListener?.('change',restart);
  return()=>{window.clearTimeout(timeout);preference.removeEventListener?.('change',restart);};
 },[]);
 const value=variations[index].text;
 const hasM=value.includes('m'),has3=value.includes('3'),hasGo=value.endsWith('go');
 return <span className="animated-wordmark playful-wordmark" role="img" aria-label="letm3go"><span className="wordmark-motion" aria-hidden="true"><span className="playful-part playful-fixed">let</span><span className={`playful-part playful-m ${hasM?'is-shown':''}`}>m</span><span className={`playful-part playful-three ${has3?'is-shown':''}`}>3</span><span className={`playful-part playful-go ${hasGo?'is-shown':''}`}>go</span><span className={`playful-part playful-arrow ${index===0||index===3||index===6?'is-shown':''}`}><BrandMark/></span></span></span>;
}
