import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repairPlan,validateLedger,validateResolutions,reconcile,assertEscalationScope} from '../../scripts/ai-defects.mjs';
import {lifecycle,commands} from '../../scripts/ai-orchestrate.mjs';
const defect=(id='BUG-ONE',failedRepairs=0)=>({id,title:'Persisted defect',kind:'software',severity:'P1',status:'open',failedRepairs,files:['src/example.js'],instructions:'Reproduce the original failure, repair and test.',observations:[]});
const finding=(id='BUG-ONE')=>({id,severity:'P1',location:'src/example.js:1',evidence:'Confirmed current failure',required_fix:'Fix original reproduction'});
const review=(role,status='persists',id='BUG-ONE')=>({role,pass:status!=='persists',summary:'Current-source review',findings:status==='persists'?[finding(id)]:[],resolutions:[{id,status,location:'src/example.js:1',evidence:'Inspected current revision and original reproduction',regression_test:'src/example.test.js'}]});
test('same snapshot from two reviewers counts once; first discovery is not a failed repair',()=>{
 let d=reconcile([], [{...review('codex'),resolutions:[]},{...review('claude'),resolutions:[]}],{revision:'r0'});
 assert.equal(d[0].failedRepairs,0);
 d=reconcile(d,[review('codex'),review('claude')],{revision:'r1',actors:{'BUG-ONE':'developer'}});
 assert.equal(d[0].failedRepairs,1);
 d=reconcile(d,[review('codex'),review('claude')],{revision:'r1',actors:{'BUG-ONE':'developer'}});
 assert.equal(d[0].failedRepairs,1);
 d=reconcile(d,[review('codex'),review('claude')],{revision:'r2',actors:{'BUG-ONE':'developer'}});
 assert.equal(repairPlan(d).escalated[0].id,'BUG-ONE');
});
test('fresh independent evidence retires an old finding; old reports do not block current code',()=>{
 const d=reconcile([defect('BUG-ONE',2)],[review('claude','resolved')],{revision:'fixed',actors:{'BUG-ONE':'codex'}});
 assert.equal(d[0].status,'resolved');assert.equal(repairPlan(d).escalated.length,0);assert.equal(d[0].severity,'P1');
});
test('Codex cannot approve its own repair',()=>{
 assert.throws(()=>reconcile([defect('BUG-ONE',2)],[review('codex','resolved')],{revision:'r',actors:{'BUG-ONE':'codex'}}),/cannot approve/);
});
test('missing IDs, inconsistent findings and software-to-hardware reclassification fail closed',()=>{
 assert.throws(()=>validateLedger([defect(),defect()]),/Duplicate/);
 assert.throws(()=>validateResolutions({...review('claude'),resolutions:[]},[defect()]),/Missing assessment/);
 assert.throws(()=>validateResolutions({...review('claude'),findings:[]},[defect()]),/omitted/);
 assert.throws(()=>validateResolutions(review('claude','device_required'),[defect()]),/relabelled/);
});
test('a newly introduced regression reopens with no old failed-repair count',()=>{
 let d=reconcile([defect('BUG-ONE',2)],[review('claude','resolved')],{revision:'fixed',actors:{'BUG-ONE':'codex'}});
 d=reconcile(d,[{...review('codex'),resolutions:[]}],{revision:'regression'});
 assert.equal(d[0].status,'open');assert.equal(d[0].failedRepairs,0);
});
test('escalations are restricted to assigned sources and practical adjacent tests',()=>{
 assert.doesNotThrow(()=>assertEscalationScope(['src/example.js','src/example.test.js'],[defect()]));
 assert.throws(()=>assertEscalationScope(['src/unrelated.js'],[defect()]),/unassigned/);
 assert.throws(()=>assertEscalationScope(['scripts/ai-orchestrate.mjs'],[defect()]),/protected/);
});
test('tracked lifecycle escalates after two actual failed DeepSeek repairs and requires Claude approval',async()=>{
 let state={head:'base',branch:'feature/isolated',digest:'before'};
 const calls=[];let generation=0;
 const result=await lifecycle({task:'Fix the confirmed defect',defects:[defect()],maxCycles:3,inspect:()=>({...state}),
  execute:async(role,prompt,cycle)=>{
   calls.push({role,cycle,prompt});
   if(['developer','escalation'].includes(role)){state.digest='edit-'+(++generation);return '';}
   if(role==='tests')return [{name:'regression',pass:cycle===3}];
   const value=review(role,cycle===3?'resolved':'persists');delete value.role;return JSON.stringify(value);
  }});
 assert.equal(result.status,'VERIFIED');
 assert.deepEqual(calls.filter(c=>c.role==='developer').map(c=>c.cycle),[1,2]);
 assert.deepEqual(calls.filter(c=>c.role==='escalation').map(c=>c.cycle),[3]);
 assert.equal(calls.some(c=>c.cycle===3&&c.role==='codex'),false);
 assert.equal(result.history[2].actors['BUG-ONE'],'codex');
 assert.deepEqual(result.history[2].approvers,['claude']);
 assert.equal(result.ledger[0].status,'resolved');
});
test('implementation uses a writable Codex session, reviews use read-only',()=>{
 assert.ok(commands('escalation','out','schema')[1].includes('workspace-write'));
 assert.ok(commands('codex','out','schema')[1].includes('read-only'));
 assert.throws(()=>commands('unknown','out','schema'),/Unknown/);
});
