import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifecycle, verdict, bounded, commands, snapshot, executeProcess, executionFailure, claudeVerdict, agentEnvironment, deepseekProfile, integrationEvidence, platformTestCommands } from '../../scripts/ai-orchestrate.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import {killProcessTree} from '../../scripts/ai-launcher.mjs';
const pass = JSON.stringify({ pass:true,summary:'Inspected complete implementation',findings:[] });
test('network and cancellation failures are infrastructure, including zero-exit Cline streams', () => {
  for (const message of ['ECONNRESET', 'ENOTFOUND api.deepseek.com', 'EAI_AGAIN', 'authentication failed']) {
    assert.equal(executionFailure({code:0,stdout:JSON.stringify({error:message})}), 'infrastructure');
  }
  assert.equal(executionFailure({code:null,error:'Cancelled'}), 'infrastructure');
  assert.equal(executionFailure({code:1,stderr:'implementation command failed'}), 'agent_execution');
  assert.equal(executionFailure({code:0,stdout:'completed'}), null);
  assert.equal(executionFailure({code:0,stdout:JSON.stringify({type:'tool_result',text:'Read documentation mentioning ENOTFOUND and API keys'})}), null);
});
test('cancelling an owned worker preserves an unrelated sibling worker', async () => {
  const sibling = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  const controller = new AbortController();
  try {
    const owned = executeProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:tmpdir(),signal:controller.signal});
    controller.abort();
    await assert.rejects(owned,/Cancelled/);
    assert.equal(sibling.exitCode,null);
    assert.doesNotThrow(()=>process.kill(sibling.pid,0));
  } finally {
    // This exact ChildProcess was created here; no process enumeration or name-based cleanup.
    sibling.kill();
  }
});
const fail = JSON.stringify({ pass:false,summary:'Defect found',findings:[{ severity:'P1',location:'add.js:1',evidence:'add(2,3) returns -1 using a-b',required_fix:'Use addition and add regression assertion' }] });
function harness(overrides = {}) {
  const state = { branch:'test/isolated',head:'abc',digest:'initial' };
  const calls = [];
  const execute = async (role,prompt,cycle) => {
    calls.push({ role,prompt,cycle });
    if (role === 'developer') { state.digest = 'implementation-'+cycle; return ''; }
    if (role === 'tests') return [{ name:'addition regression',pass:cycle > 1 }];
    return cycle === 1 ? fail : pass;
  };
  return { state,calls,options:{ task:'FULL SPEC\n'+ 'acceptance '.repeat(20000),inspect:() => ({ ...state }),execute:async (...a) => overrides.execute ? overrides.execute({ state,execute },...a) : execute(...a) } };
}
test('defect is independently found, deduplicated, repaired and verified with rerun tests',async () => {
  const h = harness();
  const r = await lifecycle(h.options);
  assert.equal(r.status,'VERIFIED');
  assert.deepEqual(h.calls.map(c => c.role),['developer','codex','claude','tests','developer','codex','claude','tests']);
  const repair = JSON.parse(h.calls[4].prompt);
  assert.equal(repair.requirements,h.options.task);
  assert.equal(repair.feedback.filter(f => f.severity).length,1);
  assert.match(repair.feedback[0].evidence,/returns -1/);
  for (const c of h.calls.filter(c => ['codex','claude'].includes(c.role))) assert.equal(JSON.parse(c.prompt).requirements,h.options.task);
});
for (const problem of ['authentication failed','CLI failure','timeout','cancelled']) {
  test(problem+' fails closed',async () => {
    const h = harness({ execute:async () => { throw Error(problem); } });
    await assert.rejects(lifecycle(h.options),new RegExp(problem));
  });
}
test('invalid JSON stops before tests or success',async () => {
  const h = harness({ execute:async ({ execute },role,...a) => role === 'codex' ? 'not json' : execute(role,...a) });
  await assert.rejects(lifecycle(h.options));
  assert.equal(h.calls.some(c => c.role === 'tests'),false);
});
for (const role of ['developer','codex','claude','tests']) {
  test(role+' branch switch is rejected',async () => {
    const h = harness({ execute:async ({state,execute},r,...a) => { const v = await execute(r,...a); if(r === role) state.branch='main'; return v; } });
    await assert.rejects(lifecycle(h.options),/Branch|modified/);
  });
}
for (const role of ['codex','claude','tests']) test(role+' content mutation is rejected',async () => {
  const h = harness({ execute:async ({state,execute},r,...a) => { const v = await execute(r,...a); if(r === role) state.digest='tampered'; return v; } });
  await assert.rejects(lifecycle(h.options),/modified/);
});
test('no implementation changes blocks',async () => {
  const h = harness({ execute:async () => '' });
  await assert.rejects(lifecycle(h.options),/No implementation/);
});
test('exhausted retries never reports verified',async () => {
  const h = harness({ execute:async ({execute},role,...a) => ['codex','claude'].includes(role) ? fail : execute(role,...a) });
  const r = await lifecycle({ ...h.options,maxCycles:2 });
  assert.equal(r.status,'BLOCKED'); assert.equal(r.history.length,2);
});
test('reviews reject contradictions, empty evidence, extra fields and missing results',() => {
  for (const raw of ['{}',JSON.stringify({pass:true,summary:'ok',findings:JSON.parse(fail).findings}),JSON.stringify({...JSON.parse(pass),extra:1}),JSON.stringify({...JSON.parse(pass),summary:''})]) assert.throws(() => verdict(raw));
});
test('limits reject nonfinite, fractional and excessive values',() => {
  for(const v of ['NaN','Infinity','0','6','1.2']) assert.throws(() => bounded(v,3,5));
});
test('developer explicitly selects DeepSeek in noninteractive mode',() => {
  const [cmd,args] = commands('developer','spec'); assert.equal(cmd,'cline');
  assert.equal(args[args.indexOf('--provider')+1],'deepseek');
  assert.ok(args.includes('--yolo')); assert.ok(args.includes('--json'));
});
test('snapshot detects changes in files already modified',() => {
  const root = mkdtempSync(join(tmpdir(),'orchestrator-snapshot-'));
  execFileSync('git',['init','-q',root]);
  writeFileSync(join(root,'code.js'),'one');
  const first = snapshot(root); writeFileSync(join(root,'code.js'),'two');
  assert.notEqual(snapshot(root),first);
});
test('disposable implementation fixture runs failing and passing executable assertions',async () => {
  const root = mkdtempSync(join(tmpdir(),'orchestrator-integration-'));
  const file = join(root,'addition.cjs');
  let generation = 0;
  const r = await lifecycle({ task:'Export addition; add(2,3) must equal 5.',
    inspect:() => ({branch:'test/fixture',head:'fixed',digest:generation ? String(generation) : 'empty'}),
    execute:async (role,prompt,cycle) => {
      if (role === 'developer') {
        if(cycle > 1) assert.match(prompt,/returns -1/);
        writeFileSync(file,cycle === 1 ? 'module.exports=(a,b)=>a-b;' : 'module.exports=(a,b)=>a+b;');
        generation++; return '';
      }
      if(role === 'tests') {
        let ok = true;
        try { execFileSync(process.execPath,['-e',`require('node:assert/strict').equal(require(${JSON.stringify(file)})(2,3),5)`],{stdio:'pipe'}); }
        catch { ok = false; }
        return [{name:'executable addition assertion',pass:ok}];
      }
      // Separate deterministic reviewer substitutes inspect actual source.
      const source = (await import('node:fs')).readFileSync(file,'utf8');
      return source.includes('a-b') ? fail : pass;
    } });
  assert.equal(r.status,'VERIFIED');
  assert.equal(r.history[0].tests[0].pass,false);
  assert.equal(r.history[1].tests[0].pass,true);
});
test('missing test evidence and terminal exception are recorded as blocked',async () => {
  const records = [];
  const h = harness({execute:async ({execute},role,...a) => role === 'tests' ? [] : execute(role,...a)});
  await assert.rejects(lifecycle({...h.options,persist:r => records.push(r)}),/Missing test evidence/);
  assert.equal(records.at(-1).status,'BLOCKED');
});
test('developer local commits are allowed',async () => {
  const h = harness({execute:async ({state,execute},role,...a) => { const v = await execute(role,...a); if(role === 'developer') state.head='other'; return v; }});
  assert.equal((await lifecycle(h.options)).status,'VERIFIED');
});
test('real subprocess nonzero exit retains test evidence',async () => {
  const r = await executeProcess(process.execPath,['-e','console.error("regression");process.exit(1)'],{cwd:tmpdir()});
  assert.equal(r.code,1); assert.match(r.stderr,/regression/);
});
test('real subprocess missing executable, timeout and excessive output fail closed',async () => {
  await assert.rejects(executeProcess('/missing/agent',[],{cwd:tmpdir()}),/ENOENT/);
  await assert.rejects(executeProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:tmpdir(),timeout:50}),/Timeout/);
  await assert.rejects(executeProcess(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],{cwd:tmpdir(),limit:100}),/Output limit/);
});
test('Claude envelopes must contain a successful complete structured review',() => {
  const good = {type:'result',subtype:'success',is_error:false,structured_output:JSON.parse(pass)};
  assert.equal(JSON.parse(claudeVerdict(JSON.stringify(good))).pass,true);
  for(const v of [{...good,is_error:true},{...good,subtype:'error_max_turns'},{...good,structured_output:null},JSON.parse(pass)]) assert.throws(() => claudeVerdict(JSON.stringify(v)));
});
test('inherited production credentials and Git overrides are omitted',() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY='test'; process.env.GIT_DIR='test';
  const env = agentEnvironment(); assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,undefined); assert.equal(env.GIT_DIR,undefined);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.GIT_DIR;
});
test('DeepSeek profile validation rejects absent, wrong and unauthenticated profiles',() => {
  const home = mkdtempSync(join(tmpdir(),'deepseek-profile-'));
  mkdirSync(join(home,'.cline/data/settings'),{recursive:true});
  const file = join(home,'.cline/data/settings/providers.json');
  assert.throws(() => deepseekProfile(home),/Missing/);
  for(const settings of [{provider:'cline',model:'deepseek-v4-flash',apiKey:'test'},{provider:'deepseek',model:'other',apiKey:'test'},{provider:'deepseek',model:'deepseek-v4-flash'}]) {
    writeFileSync(file,JSON.stringify({providers:{deepseek:{settings}}})); assert.throws(() => deepseekProfile(home),/Missing authenticated/);
  }
  writeFileSync(file,JSON.stringify({providers:{deepseek:{settings:{provider:'deepseek',model:'deepseek-v4-flash',apiKey:'test'}}}}));
  assert.deepEqual(deepseekProfile(home),{provider:'deepseek',model:'deepseek-v4-flash'});
});
test('exited CLI cleans a confirmed live descendant holding output pipes',async () => {
  const dir=mkdtempSync(join(tmpdir(),'orphan-regression-')),marker=join(dir,'pid');
  const childCode="process.send('ready');setInterval(()=>{},1000)";
  const parentCode=    "const c=require('node:child_process').spawn(process.execPath,['-e',"+JSON.stringify(childCode)+"],{stdio:['ignore',1,2,'ipc']});c.on('message',()=>{require('node:fs').writeFileSync("+JSON.stringify(marker)+",String(c.pid));process.exit(0)});";
  try {
    const r=await executeProcess(process.execPath,['-e',parentCode],{cwd:dir,timeout:30000});
    assert.equal(r.code,0);
    assert.ok(existsSync(marker),'a real descendant started before parent exit');
    const pid=Number(readFileSync(marker,'utf8'));let alive=true;try{process.kill(pid,0);}catch{alive=false;}
    assert.equal(alive,false,'inherited output pipe owner must be terminated');
  } finally {
    // Only this fixture's own confirmed child, never process-name cleanup.
    if(existsSync(marker))killProcessTree({pid:Number(readFileSync(marker,'utf8'))});
  }
});
test('integration refuses reviewers missing the seed or a test that never failed',() => {
  const first = {reviews:[JSON.parse(fail),JSON.parse(fail)],tests:[{pass:false}]};
  assert.doesNotThrow(() => integrationEvidence([first]));
  assert.throws(() => integrationEvidence([{...first,reviews:[JSON.parse(pass),JSON.parse(fail)]}]),/did not prove/);
  assert.throws(() => integrationEvidence([{...first,reviews:[JSON.parse(pass),JSON.parse(pass)]}]),/did not prove/);
  assert.throws(() => integrationEvidence([{...first,tests:[{pass:true}]}]),/did not prove/);
});
function cliWorkspace() {
  const base = mkdtempSync(join(tmpdir(),'orchestrator-cli-'));
  const source = join(base,'source'), cwd = join(base,'worktree');
  mkdirSync(source);
  execFileSync('git',['init','-q',source]);
  execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);
  execFileSync('git',['-C',source,'worktree','add','-qb','test/fixture',cwd],{stdio:'pipe'});
  const artifacts = join(cwd,'.build/ai-orchestrator'); mkdirSync(artifacts,{recursive:true});
  const script = fileURLToPath(new URL('../../scripts/ai-orchestrate.mjs',import.meta.url));
  const summary = () => JSON.parse(readFileSync(join(artifacts,readdirSync(artifacts).find(p => p !== 'active.lock'),'summary.json'),'utf8'));
  return {base,cwd,artifacts,script,summary};
}
test('existing lock produces a BLOCKED final report without removing its owner lock',async () => {
  const w = cliWorkspace(); writeFileSync(join(w.artifacts,'active.lock'),'existing-owner');
  const r = await executeProcess(process.execPath,[w.script,'--integration-test'],{cwd:w.cwd});
  assert.equal(r.code,1); assert.equal(w.summary().status,'BLOCKED');
  assert.match(w.summary().reason,/Another run holds/);
  assert.equal(readFileSync(join(w.artifacts,'active.lock'),'utf8'),'existing-owner');
});
test('SIGTERM during actual preflight records BLOCKED and releases run lock',async () => {
  const w = cliWorkspace(), bin = join(w.base,'bin'), marker = join(w.base,'preflight-started');
  mkdirSync(bin);
  writeFileSync(join(bin,'cline'),'#!'+process.execPath+'\nrequire("node:fs").writeFileSync('+JSON.stringify(marker)+',"started");setInterval(()=>{},1000);',{mode:0o700});
  if(process.platform==='win32')writeFileSync(join(bin,'cline.cmd'),'@echo off\r\n"'+process.execPath+'" "%~dp0\\cline" %*\r\n');
  const child = spawn(process.execPath,[w.script,'--integration-test'],{cwd:w.cwd,env:{...agentEnvironment(),PATH:bin+delimiter+process.env.PATH},stdio:['pipe','pipe','pipe','ipc']});
  const done = new Promise(resolve => child.once('close',resolve));
  try {
    const start = Date.now();
    while (!existsSync(marker) && Date.now()-start < 30000) await new Promise(r => setTimeout(r,20));
    assert.ok(existsSync(marker),'preflight actually started');
    if(process.platform==='win32')child.send({type:'cancel'});else child.kill('SIGTERM');
    const code = await Promise.race([done,new Promise((_,reject) => { const timer=setTimeout(()=>reject(Error('Cancellation hung')),30000); timer.unref(); })]);
    assert.equal(code,1); assert.equal(w.summary().status,'BLOCKED');
    assert.match(w.summary().reason,/Cancelled/); assert.equal(existsSync(join(w.artifacts,'active.lock')),false);
  } finally { child.kill('SIGKILL'); }
});

test('large real CLI output fits the bounded long-task allowance',async () => {
  const r = await executeProcess(process.execPath,['-e','process.stdout.write("x".repeat(9*1024*1024))'],{cwd:tmpdir()});
  assert.equal(r.code,0); assert.equal(Buffer.byteLength(r.stdout),9*1024*1024);
});

test('platform checks preserve the macOS native suite and explicitly defer it on Windows',()=>{
 assert.deepEqual(platformTestCommands('darwin'),[['npm',['run','check']],['npm',['run','test:native']]]);
 assert.deepEqual(platformTestCommands('win32'),[['npm',['run','check']]]);
});
test('deferred native checks terminate partial without consuming another implementation cycle',async()=>{
 const h=harness({execute:async({execute},role,...args)=>role==='tests'?[{name:'web',pass:true},{name:'native',pass:false,deferred:true,reason:'Requires macOS'}]:['codex','claude'].includes(role)?pass:execute(role,...args)});
 const r=await lifecycle(h.options);
 assert.equal(r.status,'PARTIAL_DEFERRED');assert.equal(r.history.length,1);assert.deepEqual(r.history[0].feedback,[]);
});
