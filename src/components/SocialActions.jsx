// The compact actions under the people in Friends and Household (Add friend,
// Family map, Invite, Settings): one row of equal, labelled buttons.
export default function SocialActions({actions,label}){
 const shown=actions.filter(Boolean);
 return <div className="social-actions" role="group" aria-label={label} style={{'--social-actions':shown.length}}>{shown.map(({id,label:text,icon:Icon,onClick,disabled,expanded})=><button key={id} type="button" className="social-action" disabled={disabled} aria-expanded={expanded} onClick={onClick}><span className="social-action-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9}/></span><span>{text}</span></button>)}</div>;
}
