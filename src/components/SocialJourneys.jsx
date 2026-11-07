import {useCallback,useEffect,useMemo,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {recorder} from '../lib/recorder.js';
import {publishActivity,makeActivityPrivate} from '../lib/activitySharing.js';
import {publicationPreview} from '../lib/activityPrivacy.js';
import {publicJourneyMap} from '../lib/publicJourneyMap.js';
import {sharingSelection} from '../lib/socialSelection.js';
import JourneyMap from './JourneyMap.jsx';
import PrivateImage from './PrivateImage.jsx';

// An activity is never auto-shared because it belongs to a household or because
// live location is enabled. This is an explicit foreground publishing workflow.
const idOf=item=>String(item?.id||'');
const same=(a,b)=>idOf(a)===idOf(b);
export default function SocialJourneys({activities=[],ownerID,receipts={},saveReceipts,onSetHome=null}) {
 const [friends,setFriends]=useState([]),[householdReady,setHouseholdReady]=useState(false);
 const [mine,setMine]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [chosen,setChosen]=useState(null);
 const [household,setHousehold]=useState(false),[allFriends,setAllFriends]=useState(false),[selectedFriends,setSelectedFriends]=useState([]);
 const [link,setLink]=useState(false),[photoIDs,setPhotoIDs]=useState([]),[publishedToken,setPublishedToken]=useState(null);
 const refresh=useCallback(async()=>{
  if(!supabase)return;
  const [f,h,p]=await Promise.all([
   supabase.rpc('my_friends'),supabase.rpc('my_household'),supabase.rpc('my_social_publications')
  ]);
  if(f.error||h.error||p.error){setError('Social journey sharing needs the new database migration and a connection.');return;}
  setFriends(f.data||[]);setHouseholdReady(Boolean(h.data?.[0]?.id));
  setMine(p.data||[]);setError('');
 },[]);
 useEffect(()=>{
  const timer=setTimeout(()=>void refresh(),0);
  const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
  const listener=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',listener);
  return()=>{clearTimeout(timer);clearInterval(poll);document.removeEventListener('visibilitychange',listener);};
 },[refresh]);
 const available=useMemo(()=>activities.filter(t=>['device','watch'].includes(t.source)&&t.state!=='recording'&&t.endedAt&&!t.provisional&&!t.readOnly&&!t.isGroupedJourney).slice(0,100),[activities]);
 const rawPhotos=useMemo(()=>chosen?.details?.photos||[],[chosen]);
 const homeReady=Boolean(chosen?.__savedPlaces?.some(p=>p.kind==='home'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)));
 const preview=useMemo(()=>{
  if(!chosen)return null;
  const selected=publicationPreview({...chosen,photos:rawPhotos.map(photo=>({...photo,point:photo.latitude!=null&&photo.longitude!=null?[photo.latitude,photo.longitude]:null}))},chosen.__savedPlaces||[],photoIDs);
  return publicJourneyMap({...selected,photos:[]});
 },[chosen,rawPhotos,photoIDs]);
 const start=async trip=>{
  setError('');setLoading(true);
  try{
   const state=await recorder.getState();
   if(state.ownerID?.toLowerCase()!==ownerID.toLowerCase())throw new Error('The recording belongs to another account.');
   const raw=state.trips.find(t=>same(t,trip));
   if(!raw||raw.details?.provisional||!raw.endedAt)throw new Error('This activity is not finalised.');
   setChosen({...raw,__savedPlaces:state.places||[]});
   setPhotoIDs([]);setSelectedFriends([]);setAllFriends(false);setHousehold(false);setLink(false);setPublishedToken(null);
  }catch(e){setError(e.message||'Activity unavailable.');}
  finally{setLoading(false);}
 };
 const share=async()=>{
  if(!chosen||loading)return;
  setError('');setLoading(true);
  try{
   const scope=sharingSelection({household,allFriends,selected:selectedFriends,link});
   const state=await recorder.getState();
   if(state.ownerID?.toLowerCase()!==ownerID.toLowerCase())throw new Error('Account changed. Sharing cancelled.');
   const raw=state.trips.find(t=>same(t,chosen));
   if(!raw||raw.updatedAt!==chosen.updatedAt||JSON.stringify(raw.points)!==JSON.stringify(chosen.points))
    throw new Error('Activity changed since review. Reopen it before publishing.');
   const result=await publishActivity({client:supabase,state,id:chosen.id,receipts,
    checkpoint:saveReceipts,audience:scope.audience,mode:scope.mode,recipients:scope.recipients,photoIDs});
   if(scope.audience==='public')setPublishedToken(result.token);
   else {setChosen(null);await refresh();}
  }catch(e){setError(e.message||'Could not publish this journey.');}
  finally{setLoading(false);}
 };
 const unshare=async trip=>{
  setLoading(true);setError('');
  try{await makeActivityPrivate(supabase,trip.id);setChosen(null);setPublishedToken(null);await refresh();}
  catch(e){setError(e.message||'Could not revoke access.');}finally{setLoading(false);}
 };
 return <section className="social-panel" aria-label="Shared journeys">
  <h2>Share an activity</h2>
  <p className="muted small-copy">Choose which of your completed activities to share. Activities shared with you appear in Activities when you enable its share filter.</p>
  {mine.length>0&&<div className="social-own-publications"><h3>My shared activities</h3>
   {mine.map(item=><div className="status-row" key={item.activity_id}><div><strong>{item.title||'Shared activity'}</strong>
    <p>{item.mode||item.audience} · {item.mode===null&&item.audience!=='public'?'Recipients need confirmation':'Shared'}</p>
    {item.audience==='public'&&item.token&&<a href={window.location.origin+'/?journey='+encodeURIComponent(item.token)}>Open public link</a>}
   </div><button type="button" className="secondary" disabled={loading} onClick={()=>void unshare({id:item.activity_id})}>Stop sharing</button></div>)}
  </div>}
  {!chosen?<details><summary>Share one of my completed activities</summary>
   {available.map(t=><div className="status-row" key={t.id}><div><strong>{t.title||t.activity}</strong><p>{new Date(t.startedAt*1000).toLocaleDateString('en-AU')}</p></div><button className="secondary" type="button" disabled={loading} onClick={()=>void start(t)}>Review &amp; share</button></div>)}
  </details>:<div className="social-share-review">
   <h3>Review before sharing: {chosen.title||chosen.activity}</h3>
   <p className="muted small-copy">The map below masks saved Home and Work areas. Only the server-approved route is delivered to viewers.</p>
   {!homeReady&&<div className="notice" role="alert"><p>Set your Home location under Places before publishing, so your route can be safely masked.</p>{onSetHome&&<button type="button" className="secondary" onClick={onSetHome}>Set Home in Places</button>}<p className="muted small-copy">Reopen this activity after saving Home to review the protected route.</p></div>}
   {preview?.routeSegments?.some(line=>line.length>1)&&<JourneyMap journeys={[preview]}/>}
   <fieldset><legend>Who can see this activity?</legend>
    {householdReady&&<label><input type="checkbox" checked={household} disabled={link} onChange={e=>setHousehold(e.target.checked)}/> My household</label>}
    <label><input type="checkbox" checked={allFriends} disabled={link} onChange={e=>{setAllFriends(e.target.checked);if(e.target.checked)setSelectedFriends([]);}}/> All current friends</label>
    {!allFriends&&!link&&friends.map(friend=><label key={friend.user_id}><input type="checkbox" checked={selectedFriends.includes(friend.user_id)} onChange={e=>setSelectedFriends(prev=>e.target.checked?[...prev,friend.user_id]:prev.filter(id=>id!==friend.user_id))}/> {friend.display_name||'Friend'}</label>)}
    <label><input type="checkbox" checked={link} onChange={e=>{setLink(e.target.checked);if(e.target.checked){setHousehold(false);setAllFriends(false);setSelectedFriends([]);}}}/> Anyone with the public link</label>
   </fieldset>
   {rawPhotos.length>0&&<fieldset><legend>Photographs to include</legend>
    <p className="muted small-copy">Unselected photos stay private. Photos at protected Home or Work locations are excluded by the server.</p>
    {rawPhotos.map(photo=><label key={photo.id}><input type="checkbox" checked={photoIDs.includes(photo.id)} onChange={e=>setPhotoIDs(ids=>e.target.checked?[...ids,photo.id]:ids.filter(id=>id!==photo.id))}/> <PrivateImage className="social-photo-thumb" src={`private-photo:${ownerID}/${chosen.id}/${photo.id}`} alt={photo.caption||'Activity photograph'}/><span>{photo.caption||'Activity photograph'}</span></label>)}
   </fieldset>}
   <div className="social-share-actions"><button type="button" className="primary" disabled={loading||!homeReady} onClick={()=>void share()}>{loading?'Publishing…':'Publish reviewed activity'}</button>
    <button type="button" className="secondary" disabled={loading} onClick={()=>setChosen(null)}>Cancel</button>
    <button type="button" className="secondary" disabled={loading} onClick={()=>void unshare(chosen)}>Make private</button>
   </div>
   {publishedToken&&<p role="status">Public journey link: <a href={window.location.origin+'/?journey='+encodeURIComponent(publishedToken)}>{window.location.origin+'/?journey='+encodeURIComponent(publishedToken)}</a></p>}
  </div>}
  {error&&<p className="error" role="alert">{error}</p>}
 </section>;
}
