import {useEffect,useRef,useState} from 'react';
import {teslaRecordingRequest} from './tesla.js';
import {fleetActivity} from './fleetJourneys.js';
const charges=rows=>(rows||[]).map(c=>({id:c.id,ownerID:c.owner_id,vehicleID:c.vehicle_id,type:'charging',verified:true,startedAt:Date.parse(c.started_at)/1000,endedAt:Date.parse(c.ended_at)/1000,latitude:c.latitude,longitude:c.longitude,batteryBefore:c.battery_before,batteryAfter:c.battery_after,energyAdded:c.energy_added}));
export function useFleetJourneys(owner,enabled){
 const [data,setData]=useState({activities:[],charges:[],error:'',next:null}),[loadingMore,setLoadingMore]=useState(false);
 const alive=useRef(false),older=useRef(false),loading=useRef(false);
 useEffect(()=>{if(!enabled||!owner)return;alive.current=true;let pending=false;
  async function refresh(event){if(pending||document.visibilityState==='hidden'||(older.current&&!event))return;pending=true;try{const result=await teslaRecordingRequest('feed');if(alive.current){older.current=false;setData({activities:(result.activities||[]).map(row=>fleetActivity(row,owner)),charges:charges(result.charges),next:result.next,error:''});}}catch{if(alive.current)setData(old=>({...old,error:'Tesla journey sync is unavailable. Your iPhone recordings are safe.'}));}finally{pending=false;}}
  void refresh();const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[owner,enabled]);
 async function loadMore(){if(!data.next||loading.current)return;loading.current=true;setLoadingMore(true);try{const result=await teslaRecordingRequest('feed',{before:data.next});if(alive.current){older.current=true;setData(old=>({...old,activities:[...new Map([...old.activities,...(result.activities||[]).map(row=>fleetActivity(row,owner))].map(t=>[t.id,t])).values()],charges:charges(result.charges),next:result.next,error:''}));}}catch{if(alive.current)setData(old=>({...old,error:'Older Tesla journeys could not be loaded. Retry when connected.'}));}finally{loading.current=false;if(alive.current)setLoadingMore(false);}}
 return {...data,more:!!data.next,loadMore,loadingMore};
}
