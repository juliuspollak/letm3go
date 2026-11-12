import {useEffect,useRef,useState} from 'react';
import PersonAvatar from './PersonAvatar.jsx';
import {Clock3,House,MoreHorizontal,TriangleAlert} from 'lucide-react';

// Everyone in Friends and Household: the same avatar, size, status dot and words.
// A tile with an action (on Home: show them on the Map) is a button; anyone else is not.
// Poking is a secondary action in the tile's own ••• menu, never part of the tap on the person.
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

// The ••• button and its one-item menu. A separate control from the tile, with its own touch target.
function MoreMenu({name,onPoke}){
 const [open,setOpen]=useState(false);
 const box=useRef(null);
 useEffect(()=>{
  if(!open)return undefined;
  const outside=event=>{if(box.current&&!box.current.contains(event.target))setOpen(false);};
  const escape=event=>{if(event.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 // Tabbing out of the control closes the menu too.
 return <div className="person-more" ref={box} onBlur={event=>{if(open&&!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <button type="button" className="person-more-button" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><MoreHorizontal size={18} aria-hidden="true"/></button>
  {open&&<div className="person-more-menu" role="menu"><button type="button" role="menuitem" onClick={()=>{setOpen(false);onPoke();}}>Poke {name}</button></div>}
 </div>;
}

export function PersonTile({person,photos,selfId,selfAvatar}){
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
  ?<button type="button" className="person-tile is-button" aria-label={`${person.actionLabel||`Show ${shown} on the map.`} ${person.status?.text||''}`.trim()} onClick={person.onSelect}>{body}</button>
  :null;
 if(tile&&person.onPoke)return <div className="person-tile-wrap">{tile}<MoreMenu name={shown} onPoke={person.onPoke}/></div>;
 return tile||<div className="person-tile" role="group" aria-label={description}>{body}</div>;
}
