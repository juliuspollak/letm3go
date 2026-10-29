// An iOS-style switch. `checked` is always the confirmed state from the caller;
// while a change is pending it shows progress instead of pretending it worked.
export default function Switch({checked,onChange,label,disabled=false,pending=false,id}){
 return <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} aria-busy={pending||undefined} disabled={disabled||pending} className={`switch${pending?' is-pending':''}`} onClick={()=>onChange?.(!checked)}><span className="switch-thumb" aria-hidden="true"/></button>;
}
