import PersonAvatar from './PersonAvatar.jsx';

// Every person in Social uses this bubble, so a household organiser, a member,
// a friend and "You" all resolve their avatar through the same id-based lookup.
export default function PersonBubble({name='Person',src=null,userId=null,selfId=null,photos=null,selfAvatar=null,label,status,action}){
 const displayName=name||'Person';
 return <div className="person-bubble"><PersonAvatar name={displayName} src={src} userId={userId} selfId={selfId} photos={photos} selfAvatar={selfAvatar} size="lg"/><strong title={label||displayName}>{label||displayName}</strong>{status&&<small>{status}</small>}{action&&<div className="person-bubble-action">{action}</div>}</div>;
}

