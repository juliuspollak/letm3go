// Small review ledger: stable IDs, fresh evidence and author-independent closure.
const ID=/^[A-Z][A-Z0-9_-]{2,79}$/;
const severities=['P0','P1','P2','P3'];
const statuses=['resolved','persists','disputed','device_required'];
export function trackedSchema(base){
 const s=structuredClone(base);
 s.properties.findings.items.required.push('id');
 s.properties.findings.items.properties.id={type:'string',pattern:ID.source};
 s.required.push('resolutions');
 s.properties.resolutions={type:'array',items:{type:'object',additionalProperties:false,
  required:['id','status','evidence','location','regression_test'],properties:{
   id:{type:'string',pattern:ID.source},status:{type:'string',enum:statuses},
   evidence:{type:'string',minLength:1},location:{type:'string',minLength:1},regression_test:{type:'string',minLength:1}
  }}};
 return s;
}
export function validateLedger(defects){
 if(!Array.isArray(defects)||new Set(defects.map(d=>d.id)).size!==defects.length)throw Error('Duplicate/missing defect IDs');
 for(const d of defects){
  if(!ID.test(d.id)||!severities.includes(d.severity)||!['software','device'].includes(d.kind)||
     !['open','confirmed','resolved','disputed','device_required'].includes(d.status)||
     !Number.isInteger(d.failedRepairs)||d.failedRepairs<0||!d.instructions?.trim()||!Array.isArray(d.files))throw Error('Invalid or untriaged defect '+d.id);
  if(d.kind==='software'&&d.status==='device_required')throw Error('Software cannot be relabelled as a device gate: '+d.id);
 }
 return structuredClone(defects).map(d=>({...d,status:d.status==='confirmed'?'open':d.status,observations:d.observations||[]}));
}
export function repairPlan(defects){
 const active=defects.filter(d=>d.kind==='software'&&['open','disputed'].includes(d.status));
 return {primary:active.filter(d=>d.failedRepairs<2),escalated:active.filter(d=>d.failedRepairs>=2)};
}
export function validateResolutions(review,defects){
 if(!Array.isArray(review.resolutions))throw Error('Missing current-source defect resolutions');
 const ids=new Set();
 for(const r of review.resolutions){
  if(!ID.test(r.id)||ids.has(r.id)||!statuses.includes(r.status)||
     !['evidence','location','regression_test'].every(k=>typeof r[k]==='string'&&r[k].trim()))throw Error('Incomplete/duplicate defect resolution');
  ids.add(r.id);
  const d=defects.find(d=>d.id===r.id);
  if(!d)throw Error('Resolution references unknown defect '+r.id);
  if(d.kind==='device'&&r.status!=='device_required')throw Error('Static review cannot close an external device gate: '+r.id);
  if(r.status==='device_required'&&d.kind!=='device')throw Error('Software cannot be relabelled as hardware: '+r.id);
  if(r.status==='persists'&&!review.findings.some(f=>f.id===r.id))throw Error('Persistent defect omitted from findings: '+r.id);
  if(['resolved','disputed'].includes(r.status)&&review.findings.some(f=>f.id===r.id))throw Error('Contradictory resolution '+r.id);
 }
 for(const d of defects.filter(d=>['open','disputed'].includes(d.status)||d.kind==='device'))if(!ids.has(d.id))throw Error('Missing assessment for '+d.id);
 if(review.findings.some(f=>!ID.test(f.id||'')))throw Error('Finding is missing a stable ID');
 return review;
}
export function reconcile(defects,reviews,{revision,actors={}}){
 if(!revision||!reviews.length)throw Error('Missing reviewed revision or independent review');
 const ledger=structuredClone(defects);
 for(const review of reviews)validateResolutions(review,ledger);
 for(const d of ledger){
  const relevant=reviews.filter(r=>actors[d.id]!=='codex'||r.role==='claude');
  if(actors[d.id]==='codex'&&!relevant.length)throw Error('Codex cannot approve its own fix: '+d.id);
  const checks=relevant.map(r=>({role:r.role,...r.resolutions.find(x=>x.id===d.id)})).filter(x=>x.status);
  if(!checks.length)continue;
  const observed=checks.some(x=>x.status==='persists')?'open':checks.every(x=>x.status==='resolved')?'resolved':
   checks.every(x=>['resolved','disputed'].includes(x.status))?'disputed':'device_required';
  d.observations.push({revision,actor:actors[d.id]||null,checks,status:observed});
  if(actors[d.id])d.lastAuthor=actors[d.id];
  if(observed==='open'&&actors[d.id]==='developer'&&d.lastFailedRevision!==revision){d.failedRepairs++;d.lastFailedRevision=revision;(d.failedRepairAttempts||=[]).push({revision,actor:'developer'});}
  if(observed==='resolved'){d.priorFailedRepairs=(d.priorFailedRepairs||0)+d.failedRepairs;d.failedRepairs=0;}
  d.status=observed;
 }
 // Current findings can reopen an old issue, but a second reviewer on the same
 // snapshot is never counted as another failed developer repair.
 for(const review of reviews)for(const f of review.findings){
  let d=ledger.find(d=>d.id===f.id);
  if(!d){
   const file=f.location.split(/[;:]/)[0].trim();
   d={id:f.id,title:f.required_fix,severity:f.severity,kind:'software',status:'open',failedRepairs:0,
    files:/^(src|ios|tests|docs|scripts)\//.test(file)?[file]:[],instructions:f.required_fix,observations:[]};
   ledger.push(d);
  }
  if(d.kind==='device')throw Error('External device checks belong in resolutions, not software findings');
  d.severity=severities.indexOf(f.severity)<severities.indexOf(d.severity)?f.severity:d.severity;
  d.status='open';d.currentEvidence={revision,role:review.role,location:f.location,evidence:f.evidence,required_fix:f.required_fix};
 }
 return ledger;
}
export function blocking(defects){return defects.filter(d=>d.kind==='software'&&d.status==='open');}
export function assertEscalationScope(changed,defects){
 const allowed=new Set(defects.flatMap(d=>d.files));
 const parents=new Set([...allowed].map(p=>p.slice(0,p.lastIndexOf('/'))));
 const native=[...allowed].some(p=>p.startsWith('ios/'));
 for(const path of changed){
  if(path.startsWith('scripts/ai-')||path.includes('orchestrator')||path.endsWith('activity-experience-v2-defects.json'))throw Error('Escalation altered protected orchestration evidence: '+path);
  if(allowed.has(path))continue;
  if(/\.test\.(js|jsx|mjs)$/.test(path)&&parents.has(path.slice(0,path.lastIndexOf('/'))))continue;
  if(native&&path.startsWith('tests/native/'))continue;
  throw Error('Escalation changed an unassigned file: '+path);
 }
}
