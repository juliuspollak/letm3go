import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Info,Users,X} from 'lucide-react';
import PersonAvatar from './PersonAvatar.jsx';
import DismissibleSheet from './DismissibleSheet.jsx';

// The one control above the Map: who it shows. [Julia ▾] opens a list (All people, Me, household,
// friends). The native map covers anything drawn over it, so the list is a sheet, like the app's other
// sheets (the map is frozen behind it and comes back as it was). Choosing someone closes it.
// people: [{userId,name,group,short,ageText,status}] (not including me).
const GROUPS=[['household','Household'],['friend','Friends']];

function Sheet({label,onClose,children}){
 const close=useRef(null),latest=useRef(onClose);
 useEffect(()=>{latest.current=onClose;});
 useEffect(()=>{
  const key=event=>{if(event.key==='Escape')latest.current();};
  document.addEventListener('keydown',key);
  return()=>document.removeEventListener('keydown',key);
 },[]);
 useEffect(()=>{close.current?.focus();},[]);
 return <div className="modal-backdrop" onClick={onClose}><DismissibleSheet label={label} onClose={onClose}>
  <button type="button" ref={close} className="close icon-button" aria-label="Close" onClick={onClose}><X/></button>
  {children}
 </DismissibleSheet></div>;
};

export default function MapPersonBar({people,selected,selectedName,viewer,onSelect,photos=null,selfAvatar=null}){
 const [open,setOpen]=useState(false),[key,setKey]=useState(false);
 const trigger=useRef(null),keyButton=useRef(null);
 const chosen=selected==null?null:selected===viewer?{userId:viewer,name:'Me',self:true}:people.find(p=>p.userId===selected)||{userId:selected,name:selectedName||'Member'};
 // Focus goes back to whatever opened the sheet.
 const close=()=>{const returnTo=key?keyButton.current:trigger.current;setOpen(false);setKey(false);returnTo?.focus();};
 const choose=userId=>{onSelect(userId);setOpen(false);trigger.current?.focus();};
 // A secondary line only where it says something not already in the name: how fresh their location is.
 const sub=chosen&&!chosen.self?(chosen.ageText?`Updated ${chosen.ageText}`:chosen.short||''):'';
 const item=(userId,name,detail,pressed,avatar)=><li key={userId??'all'}><button type="button" className="map-person-item" aria-pressed={pressed} onClick={()=>choose(userId)}>{avatar}<span className="map-person-item-text"><strong>{name}</strong>{detail&&<small>{detail}</small>}</span></button></li>;
 const avatar=(name,userId)=><PersonAvatar name={name} userId={userId} selfId={viewer} photos={photos} selfAvatar={selfAvatar} size="sm"/>;
 return <>
  <div className="map-bar">
   <button type="button" ref={trigger} className="map-person-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={`Showing ${chosen?chosen.name:'All people'}${sub?`, ${sub}`:''}. Change person`} onClick={()=>setOpen(true)}>
    {chosen?avatar(chosen.name,chosen.userId):<span className="map-person-all" aria-hidden="true"><Users size={16}/></span>}
    <span className="map-person-name">{chosen?chosen.name:'All people'}</span>
    {sub&&<span className="map-person-sub">{sub}</span>}
    <ChevronDown size={16} aria-hidden="true"/>
   </button>
   {chosen&&<button type="button" ref={keyButton} className="map-key-button" aria-label="Map key" onClick={()=>setKey(true)}><Info size={18} aria-hidden="true"/></button>}
  </div>
  {open&&<Sheet label="Choose who to show" onClose={close}>
   <h2 className="map-person-heading">Show on map</h2>
   <ul className="map-person-list">
    {item(null,'All people','Everyone on the map',selected==null,<span className="map-person-all" aria-hidden="true"><Users size={16}/></span>)}
    {item(viewer,'Me','Your own day',selected===viewer,avatar('Me',viewer))}
   </ul>
   {GROUPS.map(([group,title])=>{const members=people.filter(p=>(p.group||'friend')===group);return members.length?<section key={group} aria-label={title}><h3 className="map-person-group">{title}</h3><ul className="map-person-list">{members.map(p=>item(p.userId,p.name||'Member',p.short||p.status?.text,selected===p.userId,avatar(p.name,p.userId)))}</ul></section>:null;})}
  </Sheet>}
  {key&&<Sheet label="Map key" onClose={close}>
   <h2 className="map-person-heading">Map key</h2>
   <ul className="map-key-list">
    <li><span className="map-key-line map-key-line--gps" aria-hidden="true"/>Recorded GPS</li>
    <li><span className="map-key-line map-key-line--road" aria-hidden="true"/>Estimated road where GPS was missing</li>
    <li><span className="map-key-dot" aria-hidden="true">1</span>Activity, in order</li>
   </ul>
  </Sheet>}
 </>;
}
