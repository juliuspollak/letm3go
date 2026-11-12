import PersonAvatar from './PersonAvatar.jsx';
import {Clock3,House,TriangleAlert} from 'lucide-react';

// Everyone in Friends and Household: the same avatar, size, status dot and words.
// A tile with an action (on Home: show them on the Map) is a button; anyone else is not.
// Poking is its own small button under the status: a separate target that never opens the Map,
// and the tile never pokes.
//
// person: {id, userId, name, self, status:{text,tone}, short, role, onSelect, onPoke, poke}
export default function PeopleGrid({people,photos=null,selfId=null,selfAvatar=null,label}){
 return <ul className="people-grid" aria-label={label}>{people.map(person=><li key={person.id}><PersonTile person={person} photos={photos} selfId={selfId} selfAvatar={selfAvatar}/></li>)}</ul>;
}

function StatusDot({tone}){
 if(tone==='stale')return <span className="person-dot person-dot--stale" aria-hidden="true"><Clock3 size={10} strokeWidth={2.6}/></span>;
 if(tone==='home')return <span className="person-dot person-dot--home" aria-hidden="true"><House size={10} strokeWidth={2.6}/></span>;
 if(tone==='issue')return <span className="person-dot person-dot--issue" aria-hidden="true"><TriangleAlert size={10} strokeWidth={2.6}/></span>;
 return <span className={`person-dot person-dot--${tone}`} aria-hidden="true"/>;
}

// The Poke button's wording for each state of the request. Sending and sent are disabled, so a second tap
// cannot send a second poke.
const POKE_LABEL={idle:'👋 Poke',sending:'Poking…',sent:'✓ Poked',failed:'Retry poke'};
function PokeButton({poke,name,onPoke}){
 const state=['sending','sent','failed'].includes(poke?.state)?poke.state:'idle';
 const label=state==='idle'?`Poke ${name}`:state==='sending'?`Poking ${name}`:state==='sent'?`Poked ${name}`:`Poke ${name} failed${poke.message?`: ${poke.message}`:''}. Try again`;
 return <button type="button" className={`person-poke-button person-poke-button--${state}`} disabled={state==='sending'||state==='sent'} aria-label={label} onClick={onPoke}>{POKE_LABEL[state]}</button>;
}

export function PersonTile({person,photos,selfId,selfAvatar}){
 const name=person.name||'Person';
 const shown=person.self?'You':name;
 // The compact line when there is one; the full wording stays in the accessible name and on the detailed screens.
 const line=person.poke?.state==='received'?'Poked you 👋':person.short||person.status?.text;
 const body=<>
  <span className="person-tile-avatar"><PersonAvatar name={name} userId={person.userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/>{person.status&&<StatusDot tone={person.status.tone}/>}</span>
  <span className="person-tile-name">{shown}</span>
  {line&&<span className={`person-tile-status person-tile-status--${person.poke?.state==='received'?'received':person.status?.tone||'none'}`}>{line}</span>}
  {person.role&&<span className="person-tile-role">{person.role}</span>}
 </>;
 const description=[shown,person.status?.text,person.role].filter(Boolean).join(', ');
 const tile=person.onSelect
  ?<button type="button" className="person-tile is-button" aria-label={`${person.actionLabel||`Show ${shown} on the map.`} ${person.status?.text||''}`.trim()} onClick={person.onSelect}>{body}</button>
  :<div className="person-tile" role="group" aria-label={description}>{body}</div>;
 if(!person.onPoke)return tile;
 return <div className="person-tile-wrap">{tile}<PokeButton poke={person.poke} name={shown} onPoke={person.onPoke}/></div>;
}
