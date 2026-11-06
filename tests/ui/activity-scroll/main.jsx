import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import TripsList from '../../../src/components/TripsList.jsx';
import MobileNav from '../../../src/components/MobileNav.jsx';
import '../../../src/styles.css';

// Standalone test bundle only: never imported by the application entry point.
const journeys=Array.from({length:200},(_,i)=>({id:`scroll-${i}`,title:`Simulator activity ${String(i).padStart(3,'0')}${i%5===0?' with a longer title to exercise variable row heights':''}`,activity:i%3?'Walking':'Driving',source:'device',date:'2026-11-06',startedAt:1793923200-i*3600,endedAt:1793923800-i*3600,durationSeconds:600,distanceMeters:1200+i,stops:[],tags:[]}));
const vehicles=[];
export function Fixture(){
 const [clicks,setClicks]=useState(0);
 const [poll,setPoll]=useState(0),[opens,setOpens]=useState(0),[favourites,setFavourites]=useState([]),[mergeSource,setMergeSource]=useState(null);
 const [status,setStatus]=useState('ready');
 useEffect(()=>{
  // Reproduce background parent updates without changing immutable history objects.
  const interval=setInterval(()=>setPoll(n=>n+1),2000);
  let timer,frame,last=performance.now(),frames=0,over50=0,max=0,maxAddedRows=0;
  const mutations=new MutationObserver(records=>{const added=records.reduce((n,record)=>n+[...record.addedNodes].filter(node=>node.nodeType===1&&node.matches('[data-trip-id]')).length,0);maxAddedRows=Math.max(maxAddedRows,added);});
  mutations.observe(document.querySelector('.trips-activity-list'),{childList:true});
  const tick=now=>{const dt=now-last;last=now;frames++;if(dt>50)over50++;max=Math.max(max,dt);frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);
  const update=()=>{clearTimeout(timer);timer=setTimeout(()=>setStatus(`y=${Math.round(scrollY)} rows=${document.querySelectorAll('[data-trip-id]').length} frames=${frames} over50ms=${over50} maxMs=${Math.round(max)} maxAddedRows=${maxAddedRows}`),150);};
  window.addEventListener('scroll',update,{passive:true});
  return()=>{mutations.disconnect();clearInterval(interval);clearTimeout(timer);cancelAnimationFrame(frame);window.removeEventListener('scroll',update);};
 },[]);
 return <><main onClickCapture={event=>{if(event.target.closest('[data-action="open"]'))setClicks(n=>n+1);}} style={{margin:0,paddingTop:65}}><h1>Activity scroll fixture</h1><p>200 synthetic activities · background poll {poll}</p><TripsList journeys={journeys} unit="km" sort="newest" query="" favourites={favourites} vehicles={vehicles} busy={false} showArchived={false} mergeSource={mergeSource} mergeTarget={null} onOpen={()=>setOpens(n=>n+1)} onBookmark={id=>setFavourites(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])} onEquipment={()=>{}} onArchive={()=>{}} onDelete={()=>{}} onRestore={()=>{}} onMergeSelect={setMergeSource} onMergeTarget={()=>{}}/></main><div role="status" aria-label={`Scroll diagnostics ${status} opens=${opens} clicks=${clicks} merge=${mergeSource||'none'}`} style={{position:'fixed',top:0,left:0,right:0,padding:'env(safe-area-inset-top) 8px 4px',background:'white',fontSize:11,zIndex:600,pointerEvents:'none'}}>{status} opens={opens} clicks={clicks} merge={mergeSource||'none'}</div><MobileNav tab="Trips" onSelect={()=>{}}/></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
