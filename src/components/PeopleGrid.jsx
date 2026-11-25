import {useEffect,useState} from 'react';
import PersonAvatar from './PersonAvatar.jsx';
import {personTileLocation} from '../lib/homePeople.js';
import {travelDuration} from '../lib/useDriveTimes.js';
import {Bike,CarFront,Clock3,Footprints,House,Snail,TriangleAlert} from 'lucide-react';

// Everyone in Friends and Household: the same avatar, size, status dot and words.
// A tile with an action (on Home: show them on the Map) is a button; anyone else is not.
// Poking is its own small button under the status: a separate target that never opens the Map,
// and the tile never pokes.
//
// person: {id, userId, name, self, status:{text,tone}, short, role, onSelect, onPoke, poke}
export default function PeopleGrid({people,photos=null,selfId=null,selfAvatar=null,label}){
 return <ul className={people.some(person=>person.location)?"people-grid people-grid--locations":"people-grid"} aria-label={label}>{people.map(person=><li key={person.id}><PersonTile person={person} photos={photos} selfId={selfId} selfAvatar={selfAvatar}/></li>)}</ul>;
}

// Shown in place of the list while it is still loading, so "nobody is sharing" is never claimed too early.
export function PeopleSkeleton({count=3}){
 return <ul className="people-grid people-skeleton" role="status" aria-busy="true" aria-label="Loading friends">{Array.from({length:count},(_,i)=><li key={i} aria-hidden="true"><span className="skeleton-avatar"/><span className="skeleton-line"/><span className="skeleton-line short"/></li>)}</ul>;
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

const travelModes=[
 ['drive','driveSeconds',CarFront],
 ['walk','walkSeconds',Footprints],
 ['cycle','cycleSeconds',Bike],
];

function snailDuration(walkSeconds){
 if(!Number.isFinite(walkSeconds)||walkSeconds<0)return '';
 const days=Math.round(walkSeconds*1000/86400);
 return days===0?'<1 day':days===1?'1 day':`${days} days`;
}

function TravelTimes({travel}){
 return <span className={travel.length>1?"person-travel person-travel--alternating":"person-travel"} data-count={travel.length} aria-hidden="true">
  {travel.map(({label,time,Icon},index)=><span key={label} className={`person-travel-${label}`} style={{animationDelay:`${index===0?0:-3*(travel.length-index)}s`}}>
   <Icon size={12}/>{time.includes(' h')?time.replace(' h','h').replace(' min','m'):time}{label==='snail'?'':` ${label}`}
  </span>)}
 </span>;
}

function RefreshClock({children}){
 const [visible,setVisible]=useState(true);
 useEffect(()=>{
  const timer=setTimeout(()=>setVisible(false),2000);
  return()=>clearTimeout(timer);
 },[]);
 return visible
  ?<span className="person-avatar person-avatar--lg person-refresh-clock" aria-hidden="true"><Clock3 size={27} strokeWidth={1.7}/></span>
  :children;
}

export function PersonTile({person,photos,selfId,selfAvatar}){
 const name=person.name||'Person';
 const shown=person.self?'You':name;
 // The compact line when there is one; the full wording stays in the accessible name and on the detailed screens.
 const line=person.poke?.state==='received'?'Poked you 👋':person.poke?.state==='failed'&&person.poke.message?person.poke.message:person.short||person.status?.text;
 const tileStatus=person.location?personTileLocation(person.location):person.status;
 const showRefreshClock=['No new location','Request failed','Couldn’t check'].includes(person.refreshLabel);
 const atHome=tileStatus?.tone==='home';
 const travel=atHome?[]:[
  ...travelModes.map(([label,key,Icon])=>({label,Icon,time:travelDuration(person[key])})),
  {label:'snail',Icon:Snail,time:snailDuration(person.walkSeconds)},
 ].filter(mode=>mode.time);
 const location=person.location?[atHome?(tileStatus.lastKnown?'Last verified at home':'At home'):null,tileStatus.text].filter(Boolean).join(' · '):'';
 const showPoke=person.poke?.state==='received'||person.poke?.state==='failed';
 const shownLine=showPoke?line:tileStatus?.text&&person.location?tileStatus.text:line;
 const avatar=<>
  <PersonAvatar name={name} userId={person.userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/>
  {tileStatus&&(!atHome||tileStatus.lastKnown)&&<StatusDot tone={tileStatus.lastKnown?'stale':tileStatus.tone}/>}
 </>;
 const body=<>
  {travel.length>0&&<TravelTimes travel={travel}/>}
  <span className="person-tile-avatar">
   {showRefreshClock?<RefreshClock>{avatar}</RefreshClock>:avatar}
  </span>
  <span className="person-tile-heading">{atHome&&<House size={13} aria-hidden="true"/>}<span className="person-tile-name">{shown}</span></span>
  {shownLine&&(!atHome||showPoke||showRefreshClock)&&<span className={`person-tile-status person-tile-status--${person.poke?.state==='received'?'received':person.poke?.state==='failed'?'failed':tileStatus?.tone||'none'}`}>{shownLine}</span>}
  {person.refreshLabel&&<span className="person-tile-status" role="status">{person.refreshLabel}</span>}
  {person.role&&<span className="person-tile-role">{person.role}</span>}
 </>;
 const travelDescription=travel.length?`${(person.location?.state||person.state)==='stale'?'To last known location. ':''}${travel.map(({time,label})=>`${time} ${label}`).join(', ')}`:'';
 const description=[shown,location||tileStatus?.text,person.role,person.refreshLabel,travelDescription].filter(Boolean).join(', ');
 const tile=person.onSelect
  ?<button type="button" className="person-tile is-button" aria-label={`${person.actionLabel||`Show ${shown} on the map.`} ${location||person.status?.text||''}${person.refreshLabel?`. ${person.refreshLabel}.`:''}${travelDescription?`. ${travelDescription}.`:''}`.trim()} onClick={person.onSelect}>{body}</button>
  :<div className="person-tile" role="group" aria-label={description}>{body}</div>;
 if(!person.onPoke)return tile;
 return <div className="person-tile-wrap">{tile}<PokeButton poke={person.poke} name={shown} onPoke={person.onPoke}/></div>;
}
