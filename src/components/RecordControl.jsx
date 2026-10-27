// One record control for the bottom navigation and the record panel. The dot
// morphs into a stop square as the recorder state changes; the halo breathes only
// while something is actually being recorded, so the animation never runs idle.
export default function RecordControl({state='idle',label='Record',title=null,current=false,onClick,disabled=false,variant='nav'}){
 const busy=['starting','saving'].includes(state);
 return <button type="button" className={`record-control record-control--${variant} is-${state}${current?' is-current':''}`} aria-label={label} aria-current={current?'page':undefined} aria-busy={busy||undefined} title={title||label} disabled={disabled} onClick={onClick} data-state={state}>
  <span className="record-control-halo" aria-hidden="true"/>
  <span className="record-control-ring" aria-hidden="true"/>
  <span className="record-control-core" aria-hidden="true">
   <span className="record-control-shape"/>
   {busy&&<span className="record-control-spinner"/>}
  </span>
 </button>;
}
