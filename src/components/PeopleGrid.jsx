import {useEffect,useRef,useState} from 'react';
import PersonAvatar from './PersonAvatar.jsx';
import {Clock3,House,TriangleAlert} from 'lucide-react';

// Everyone in Friends and Household: the same avatar, size, status dot and words.
// A tile with an action (on Home: show them on the Map) is a button; anyone else is not.
// A tap on the person opens them on the Map. Poking is a press and hold: the tile shakes while held and
// pokes when the hold completes; letting go early, or scrolling, does nothing.
//
// person: {id, userId, name, self, status:{text,tone}, role, onSelect}
export default function PeopleGrid({people,photos=null,selfId=null,selfAvatar=null,label}){
 return <ul className="people-grid" aria-label={label}>{people.map(person=><li key={person.id}><PersonTile person={person} photos={photos} selfId={selfId} selfAvatar={selfAvatar}/></li>)}</ul>;
}

function StatusDot({tone}){
 if(tone==='stale')return <span className="person-dot person-dot--stale" aria-hidden="true"><Clock3 size={10} strokeWidth={2.6}/></span>;
 if(tone==='home')return <span className="person-dot person-dot--home" aria-hidden="true"><House size={10} strokeWidth={2.6}/></span>;
 if(tone==='issue')return <span className="person-dot person-dot--issue" aria-hidden="true"><TriangleAlert size={10} strokeWidth={2.6}/></span>;
 return <span className={`person-dot person-dot--${tone}`} aria-hidden="true"/>;
}

// A quiet line under the status, not a bubble: confirmation of a poke sent, or one received.
const POKE_TEXT={sent:'Poked ✓',received:'Poked you 👋',failed:'Couldn’t poke'};
function PokeLine({poke}){
 return <span className={`person-tile-poke person-tile-poke--${poke.state}`} role="status">{POKE_TEXT[poke.state]}{poke.state==='failed'&&poke.message?` · ${poke.message}`:''}</span>;
}

// Press and hold. The shake starts a moment into the hold so a normal tap never flickers; the poke is
// sent when the hold completes. The click that follows the release is swallowed, so a poke never also navigates.
export const SHAKE_AFTER_MS=250,HOLD_MS=700,MOVE_LIMIT=12;
function useHoldToPoke(onPoke){
 const timers=useRef([]),start=useRef(null),fired=useRef(false);
 const [holding,setHolding]=useState(false);
 const clear=()=>{timers.current.forEach(clearTimeout);timers.current=[];setHolding(false);};
 useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
 if(!onPoke)return {holding:false,handlers:{}};
 return {holding,handlers:{
  onPointerDown:event=>{
   if(event.button>0)return;
   fired.current=false;start.current={x:event.clientX,y:event.clientY};
   timers.current=[setTimeout(()=>setHolding(true),SHAKE_AFTER_MS),setTimeout(()=>{fired.current=true;clear();onPoke();},HOLD_MS)];
  },
  onPointerMove:event=>{if(start.current&&timers.current.length&&Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>MOVE_LIMIT)clear();},
  onPointerUp:clear,onPointerCancel:clear,onPointerLeave:clear,
  onContextMenu:event=>event.preventDefault(),
  // The tap that ends a completed hold must not open the Map.
  onClickCapture:event=>{if(fired.current){fired.current=false;event.stopPropagation();event.preventDefault();}}
 }};
}

export function PersonTile({person,photos,selfId,selfAvatar}){
 const hold=useHoldToPoke(person.onSelect?person.onPoke:null);
 const name=person.name||'Person';
 const shown=person.self?'You':name;
 const body=<>
  <span className="person-tile-avatar"><PersonAvatar name={name} userId={person.userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/>{person.status&&<StatusDot tone={person.status.tone}/>}</span>
  <span className="person-tile-name">{shown}</span>
  {person.status&&<span className={`person-tile-status person-tile-status--${person.status.tone}`}>{person.status.text}</span>}
  {person.role&&<span className="person-tile-role">{person.role}</span>}
  {person.poke&&<PokeLine poke={person.poke}/>}
 </>;
 const description=[shown,person.status?.text,person.role].filter(Boolean).join(', ');
 const tile=person.onSelect
  ?<button type="button" className={`person-tile is-button${person.onPoke?' person-tile--holdable':''}${hold.holding?' is-holding':''}`} aria-label={`${person.actionLabel||`Show ${shown} on the map.`} ${person.status?.text||''}`.trim()} aria-description={person.onPoke?`Press and hold to poke ${shown}.`:undefined} onClick={person.onSelect} {...hold.handlers}>{body}</button>
  :null;
 // Screen readers and keyboards cannot hold: they get a hidden, focusable Poke button.
 if(tile&&person.onPoke)return <div className="person-tile-wrap">{tile}<button type="button" className="sr-only" onClick={person.onPoke}>Poke {shown}</button></div>;
 return tile||<div className="person-tile" role="group" aria-label={description}>{body}</div>;
}
