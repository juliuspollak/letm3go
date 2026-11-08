import PersonAvatar from './PersonAvatar.jsx';
import {Clock3,House,TriangleAlert} from 'lucide-react';

// Everyone in Friends and Household: the same avatar, size, status dot and words.
// A tile with an action (on Home: poke them) is a button; anyone else is not.
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

export function PersonTile({person,photos,selfId,selfAvatar}){
 const name=person.name||'Person';
 const shown=person.self?'You':name;
 const body=<>
  <span className="person-tile-avatar"><PersonAvatar name={name} userId={person.userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/>{person.status&&<StatusDot tone={person.status.tone}/>}</span>
  <span className="person-tile-name">{shown}</span>
  {person.status&&<span className={`person-tile-status person-tile-status--${person.status.tone}`}>{person.status.text}</span>}
  {person.role&&<span className="person-tile-role">{person.role}</span>}
 </>;
 const description=[shown,person.status?.text,person.role].filter(Boolean).join(', ');
 return person.onSelect
  ?<button type="button" className="person-tile is-button" aria-label={`${person.actionLabel||`Show ${shown} on the map.`} ${person.status?.text||''}`.trim()} onClick={person.onSelect}>{body}</button>
  :<div className="person-tile" role="group" aria-label={description}>{body}</div>;
}
