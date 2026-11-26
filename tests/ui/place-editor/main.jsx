import React,{useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {registerPlugin} from '@capacitor/core';
import Places from '../../../src/components/Places.jsx';
import DismissibleSheet from '../../../src/components/DismissibleSheet.jsx';
import '../../../src/styles.css';

// Standalone test bundle only: never imported by the application entry point. It is the production Places editor inside the
// production sheet, with only the recorder calls that need a signed-in account answered here, so the live native map is the real one.
const HOME={id:'4b2d6a3e-9f8c-4a57-8c1e-0d5a7e6b1c11',name:'Home',kind:'home',latitude:-34.546189,longitude:150.853836,radius:100,homeRecognitionRadius:60,shareWithFriends:false};
// Sydney Opera House: about 80 km from Home, so choosing it must bring the map to it.
const FAR={latitude:-33.8568,longitude:151.2153};
const maps=registerPlugin('AppleMaps');
const FRIEND={id:'people:friend',kind:'people',point:[FAR.latitude,FAR.longitude],title:'Sam',subtitle:'Sharing location',
 members:[{id:'friend',name:'Sam',initial:'S',state:'live'}]};
const STALE_FRIEND={id:'people:stale-friend',kind:'people',point:[FAR.latitude+0.006,FAR.longitude],title:'Lee',
 subtitle:'Last updated 15 min ago',label:'15 min ago',labelKind:'stale',
 members:[{id:'stale-friend',name:'Lee',initial:'L',state:'stale'}]};

export function Fixture(){
 const [social,setSocial]=useState(false);
 const [places,setPlaces]=useState([HOME]);
 const [saved,setSaved]=useState('none');
 const [picked,setPicked]=useState({text:'none',count:0});
 const [rect,setRect]=useState('none');
 // What the native map reports for a tap, read straight from the plugin so it is independent of what the editor does with it.
 useEffect(()=>{
  let handle,gone=false;
  maps.addListener('locationPicked',event=>setPicked(previous=>({text:`${event.latitude.toFixed(6)},${event.longitude.toFixed(6)}`,count:previous.count+1}))).then(h=>{if(gone)h.remove();else handle=h;});
  return()=>{gone=true;handle?.remove();};
 },[]);
 // Where the page puts the map's placeholder, to compare with where the native map really is.
 useEffect(()=>{
  const timer=setInterval(()=>{
   const element=document.querySelector('.place-picker');
   if(!element){setRect('none');return;}
   const box=element.getBoundingClientRect();
   setRect([box.x,box.y,box.width,box.height].map(value=>Math.round(value)).join(','));
  },150);
  return()=>clearInterval(timer);
 },[]);
 const run=useCallback(async(name,...args)=>{
  if(name==='savePlace'){
   const place=args[0];
   setSaved(JSON.stringify({name:place.name,kind:place.kind,latitude:Number(place.latitude.toFixed(6)),longitude:Number(place.longitude.toFixed(6)),radius:place.radius,homeRecognitionRadius:place.homeRecognitionRadius??null}));
   setPlaces(current=>[...current.filter(item=>item.id!==place.id),{...place,id:place.id||HOME.id}]);
   return {ok:true};
  }
  if(name==='searchAddress')return {results:[{name:'Sydney Opera House',...FAR}]};
  if(name==='currentPosition')return {...FAR,accuracy:12};
  return {};
 },[]);
 return <div className="modal-backdrop">
  <DismissibleSheet label="Places" onClose={()=>{}}>
   {/* Always on screen (sticky, zero height so the layout is the production layout), because the test reads these lines whatever the
       sheet's scroll position. Inside the dialog, so the accessibility tree keeps it. */}
   <div style={{position:'sticky',top:0,height:0,zIndex:30,pointerEvents:'none'}}>
    <section aria-label="Fixture status" style={{position:'absolute',left:0,right:0,top:-32,fontSize:10,lineHeight:'12px',background:'rgba(255,255,255,.85)',padding:'1px 4px'}}>
     {/* One string per line: WebKit exposes every React text node as its own accessibility element. */}
     <p style={{margin:0}}>{`picked: ${picked.text} #${picked.count}`}</p>
     <p style={{margin:0}}>{`saved: ${saved}`}</p>
     <p style={{margin:0}}>{`rect: ${rect}`}</p>
    </section>
   </div>
   {!social&&<button type="button" onClick={()=>setSocial(true)}>Social locations</button>}
   <Places key={String(social)} household={social} mapCenter={social?HOME:undefined} peoplePins={social?[FRIEND,STALE_FRIEND]:undefined} places={social?[]:places} run={run} busy={false} error=""/>
  </DismissibleSheet>
 </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
