import PersonAvatar from './PersonAvatar.jsx';

// Who the Map tab shows: everyone (the map as it was), me, or one household member or friend.
// A compact, horizontally scrolling row; choosing someone never changes the saved Map filters.
// people: [{userId,name,status:{tone}}] (not including me).
export default function MapPeopleSelector({people,selected,onSelect,viewer,photos=null,selfAvatar=null}){
 const choose=userId=>()=>onSelect(userId===selected?null:userId);
 return <div className="map-people-selector" role="group" aria-label="Show on map">
  <button type="button" className="map-person-chip" aria-pressed={selected==null} onClick={()=>onSelect(null)}><span>All people</span></button>
  <button type="button" className="map-person-chip" aria-pressed={selected===viewer} aria-label="Me" onClick={choose(viewer)}><PersonAvatar name="You" userId={viewer} selfId={viewer} photos={photos} selfAvatar={selfAvatar} size="sm"/><span>Me</span></button>
  {people.map(person=><button key={person.userId} type="button" className={`map-person-chip${person.status?.tone?` map-person-chip--${person.status.tone}`:''}`} aria-pressed={selected===person.userId} aria-label={[person.name,person.status?.text].filter(Boolean).join(', ')} onClick={choose(person.userId)}><PersonAvatar name={person.name} userId={person.userId} selfId={viewer} photos={photos} selfAvatar={selfAvatar} size="sm"/><span>{person.name||'Member'}</span></button>)}
 </div>;
}
