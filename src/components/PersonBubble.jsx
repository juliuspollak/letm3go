import PersonAvatar from './PersonAvatar.jsx';

export default function PersonBubble({name='Person',src=null,label,status,action}){
 const displayName=name||'Person';
 return <div className="person-bubble"><PersonAvatar name={displayName} src={src} size="lg"/><strong title={label||displayName}>{label||displayName}</strong>{status&&<small>{status}</small>}{action&&<div className="person-bubble-action">{action}</div>}</div>;
}
