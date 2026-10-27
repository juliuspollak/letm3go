import {useEffect,useRef,useState} from 'react';
import BrandMark from './BrandMark.jsx';
import {useReducedMotion} from '../lib/motion.js';
import {WORDMARK_INTRO,WORDMARK_SEQUENCE} from '../lib/wordmark.js';

const LETTERS=['l','e','t','m','3','g','o'];

// The wordmark assembles once, rests, then the 3 becomes the three accent lines,
// the word folds to "let" plus the mark, and it rebuilds. Repeats are deliberately
// infrequent (a 27 s rest) so the header never becomes distracting.
export default function AnimatedWordmark({phase:fixedPhase=null}){
 const reduced=useReducedMotion();
 const [phase,setPhase]=useState('intro');
 const started=useRef(false);

 useEffect(()=>{
  if(reduced||fixedPhase)return;
  let alive=true,timer=null,index=0;
  const clear=()=>{if(timer!==null){window.clearTimeout(timer);timer=null;}};
  const step=()=>{
   if(!alive)return;
   // Backgrounded WebViews keep timers alive; stop the loop instead of animating
   // invisibly and burning battery.
   if(document.visibilityState==='hidden'){clear();return;}
   const item=WORDMARK_SEQUENCE[index];
   index=(index+1)%WORDMARK_SEQUENCE.length;
   setPhase(item.phase);
   timer=window.setTimeout(step,item.hold);
  };
  const restart=()=>{
   clear();index=0;
   if(document.visibilityState==='hidden')return;
   // Only the first appearance plays the full assemble gesture.
   const intro=!started.current;
   started.current=true;
   setPhase(intro?'intro':'rest');
   timer=window.setTimeout(step,intro?WORDMARK_INTRO:WORDMARK_SEQUENCE[0].hold);
  };
  const visibility=()=>{if(document.visibilityState==='hidden')clear();else restart();};
  restart();
  document.addEventListener('visibilitychange',visibility);
  return()=>{alive=false;clear();document.removeEventListener('visibilitychange',visibility);};
 },[reduced,fixedPhase]);

 // `phase` freezes one frame of the sequence for design review and tests.
 const shown=fixedPhase||(reduced?'rest':phase);
 return <span className="wordmark" role="img" aria-label="letm3go" data-phase={shown}>
  <span className="wordmark-frame" aria-hidden="true">
   <span className="wordmark-word">
    {LETTERS.map((letter,index)=>letter==='3'
     ?<span key={letter} className="wordmark-letter wordmark-three is-accent" data-letter="3" style={{'--i':index}}>
       <span className="wordmark-three-digit">3</span>
       <span className="wordmark-three-lines"><i/><i/><i/></span>
      </span>
     :<span key={letter} className="wordmark-letter" data-letter={letter} style={{'--i':index}}>{letter}</span>)}
    <span className="wordmark-arrow"><BrandMark/></span>
   </span>
  </span>
 </span>;
}

