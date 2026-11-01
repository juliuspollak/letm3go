#!/usr/bin/env node
// Local three-agent loop for an existing isolated Git worktree.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, closeSync, openSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {trackedSchema,validateLedger,repairPlan,validateResolutions,reconcile,blocking,assertEscalationScope} from './ai-defects.mjs';
import {windowsEnvironment,homeDir,resolveCommand,killProcessTree,nativeCheckPolicy} from './ai-launcher.mjs';

export const schema = {
  type: 'object', additionalProperties: false, required: ['pass', 'summary', 'findings'],
  properties: { pass: { type: 'boolean' }, summary: { type: 'string' }, findings: {
    type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'location', 'evidence', 'required_fix'],
      properties: Object.fromEntries(['severity', 'location', 'evidence', 'required_fix'].map(k =>
        [k, k === 'severity' ? { type: 'string', enum: ['P0','P1','P2','P3'] } : { type: 'string', minLength: 1 }])) }
  } }
};
export function verdict(raw) {
  const v = JSON.parse(raw);
  if (!v || !['findings,pass,summary','findings,pass,resolutions,summary'].includes(Object.keys(v).sort().join()) || typeof v.pass !== 'boolean' ||
      typeof v.summary !== 'string' || !v.summary.trim() || !Array.isArray(v.findings) ||
      v.pass !== (v.findings.length === 0) || v.findings.some(f => !f ||
        !['evidence,location,required_fix,severity','evidence,id,location,required_fix,severity'].includes(Object.keys(f).sort().join()) ||
        !['P0','P1','P2','P3'].includes(f.severity) ||
        !['location','evidence','required_fix'].every(k => typeof f[k] === 'string' && f[k].trim()))) {
    throw Error('Incomplete or inconsistent review');
  }
  return v;
}
export function bounded(value, fallback, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw Error('Invalid execution limit');
  return n;
}
export function commands(role, report, schemaPath, model = 'deepseek-v4-flash', timeout = 900, outputSchema = schema) {
  if (role === 'developer') return ['cline', ['--json','--yolo','--provider','deepseek','--model',model,
    '--retries','2','--timeout',String(timeout),'Implement the complete task supplied on stdin.']];
  if (role === 'escalation') return ['codex',['exec','--ignore-user-config','--ephemeral','--sandbox','workspace-write','-c','approval_policy="never"','--output-last-message',report,'-']];
  if (role === 'codex') return ['codex', ['exec','--ignore-user-config','--ephemeral','--sandbox','read-only',
    '--skip-git-repo-check','--output-schema',schemaPath,'--output-last-message',report,'-']];
  if(role!=='claude')throw Error('Unknown agent role: '+role);
  return ['claude', ['-p','--restricted','--permission-mode','plan',
    '--tools','Read,Glob,Grep','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
    '--disable-slash-commands','--no-session-persistence',
    '--output-format','json','--json-schema',JSON.stringify(outputSchema),'Review the complete task supplied on stdin.']];
}
export function claudeVerdict(raw) {
  const result = JSON.parse(raw);
  if (result.type !== 'result' || result.subtype !== 'success' || result.is_error || !result.structured_output) {
    throw Error('Claude did not complete its structured review');
  }
  return JSON.stringify(verdict(JSON.stringify(result.structured_output)));
}
// Deliberately omit inherited service credentials, Git overrides and deployment settings.
export function agentEnvironment() {
  const posix = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','TERM','USER','LOGNAME',
    'NODE_EXTRA_CA_CERTS'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
  return { ...windowsEnvironment(), ...posix };
}
export async function executeProcess(cmd, args, { cwd, input = '', timeout = 900000, limit = 32*1024*1024, env = agentEnvironment(), signal: abortSignal }) {
  const resolved = resolveCommand(cmd, args, env);
  return new Promise((resolveResult, reject) => {
    const child = spawn(resolved.file,resolved.args,{ cwd,env,detached:true,windowsHide:true,stdio:['pipe','pipe','pipe'] });
    let stdout = '', stderr = '', bytes = 0, failure;
    const kill = reason => {
      failure ||= reason;
      if(process.platform!=='win32'||(child.exitCode===null&&child.signalCode===null))killProcessTree(child);
      setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();},2000).unref();
    };
    const cancel = () => kill('Cancelled');
    process.once('SIGINT',cancel); process.once('SIGTERM',cancel);
    if (abortSignal?.aborted) cancel(); else abortSignal?.addEventListener('abort',cancel,{once:true});
    const timer = setTimeout(() => kill('Timeout'),timeout);
    for (const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data',data => {
        bytes += Buffer.byteLength(data);
        if (bytes > limit) { kill('Output limit exceeded'); return; }
        if (key === 'stdout') stdout += data; else stderr += data;
      });
    }
    child.stdin.on('error',() => {});
    child.stdin.end(input);
    child.once('error',error => { failure = error.message; });
    child.once('exit',() => {
      if(process.platform!=='win32')killProcessTree(child);
      else {
        // A dead PID can already have been reused. Never taskkill it. If an
        // orphan holds pipes open, fail boundedly rather than hanging forever.
        const drain=setTimeout(()=>{failure ||= 'Windows descendant cleanup unverified: output pipes survived parent exit';child.stdout.destroy();child.stderr.destroy();},2000);
        drain.unref();child.once('close',()=>clearTimeout(drain));
      }
    });
    child.once('close',(code,signal) => {
      abortSignal?.removeEventListener('abort',cancel);
      clearTimeout(timer); process.removeListener('SIGINT',cancel); process.removeListener('SIGTERM',cancel);
      // Terminate any descendants left behind by a CLI, including on success.
      if(process.platform!=='win32')killProcessTree(child);
      const result = { code,signal,stdout,stderr,error:failure };
      if (failure) reject(Object.assign(Error(failure),{ result })); else resolveResult(result);
    });
  });
}
const hash = data => createHash('sha256').update(data).digest('hex');
export function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 32*1024*1024 });
  if (r.status !== 0 || r.error) throw Error('Git inspection failed');
  return r.stdout.trim();
}
export function snapshot(root) {
  const files = git(root,'ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean);
  return hash(files.sort().map(p => {
    const file = join(root,p);
    if (!existsSync(file)) return p + ':DELETED';
    if (!lstatSync(file).isFile()) throw Error('Symlink or non-file in scope: '+p);
    return p + ':' + lstatSync(file).mode + ':' + hash(readFileSync(file));
  }).join('\n'));
}
// The same small loop drives real CLIs and deterministic regression tests.
async function runLifecycle({ task, maxCycles = 5, execute, inspect, persist = () => {}, defects, checkpoint = () => {} }) {
  maxCycles = bounded(maxCycles, 5, 5);
  if (typeof task !== 'string' || !task.trim()) throw Error('Empty requirements');
  const origin = inspect();
  let feedback = [];
  let ledger=defects?validateLedger(defects):null;
  const history = [];
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const proposed=ledger?repairPlan(ledger):null;
    // Separate authors into separately reviewed cycles; Codex cannot review a
    // combined patch containing its own escalation changes.
    const plan=proposed?.primary.length?{...proposed,escalated:[]}:proposed;
    if(plan&&!plan.primary.length&&!plan.escalated.length&&feedback.some(t=>t.pass===false))throw Error('Required test failed with no assigned repair; explicit triage required');
    const actors={};
    const prompt = JSON.stringify({ requirements: task, feedback, cycle,
      assignedDefects:plan?.primary, deferredToCodex:plan?.escalated.map(d=>d.id),
      repairPolicy:'Reproduce each assigned failure, fix its root cause, add a regression, verify the original scenario. Do not edit the defects assigned to Codex. Do not mark your own work approved.',
      instructions: 'Work only in the current isolated working directory. Audit surrounding code, implement all requirements, add regression tests. Local edits, tests and commits are allowed. Never push, merge, deploy, run remote SQL, change branches, read secrets or disable tests. Do not modify the orchestrator or its evidence. Do not run other AI agents.' });
    if(!plan||plan.primary.length){
      const authored = await execute('developer',prompt,cycle);
      // Assignment is not evidence that a repair touched this defect.
      if(plan)for(const d of plan.primary)if(authored?.changedFiles?.some(file=>d.files.includes(file)))actors[d.id]='developer';
      if(inspect().branch!==origin.branch)throw Error('Branch changed');
      await checkpoint('developer',cycle);
    }
    if(plan?.escalated.length){
      await execute('escalation',JSON.stringify({requirements:task,cycle,assignedDefects:plan.escalated,
        instructions:'Engineering escalation: implement ONLY the listed confirmed defects that survived two DeepSeek repairs. Read latest source and reproduce; preserve other work, make minimal root-cause fixes and meaningful regression tests. No branch changes, push, merge, deploy, remote SQL, credentials, test weakening or other agents. Do not edit the orchestrator or ledger. You are the AUTHOR, not an approver. Independent Claude must verify each fix.'}),cycle);
      for(const d of plan.escalated)actors[d.id]='codex';
      if(inspect().branch!==origin.branch)throw Error('Branch changed');
      await checkpoint('codex-escalation',cycle);
    }
    let state = inspect();
    if (state.branch !== origin.branch) throw Error('Branch changed');
    const reviewedHead = state.head;
    if (state.digest === origin.digest && cycle === 1) throw Error('No implementation changes');
    const reviewed = state.digest;
    const reviews = [];
    const approvers=plan?.escalated.length?['claude']:['codex','claude'];
    for (const role of approvers) {
      reviews.push(verdict(await execute(role, JSON.stringify({ requirements: task,
        instructions: (role === 'codex' ? 'Independent architecture review: inspect surrounding code, cross-layer integration, security, privacy, persistence, concurrency and reliability.' : 'Independent QA review: inspect functional completeness, test validity, edge cases, UX, accessibility and regressions.') + ' Read only. Review the full original requirements and current implementation; report every actionable omission with evidence. Do not infer simulator or hardware success. Do not run other AI agents.',
        role, base: origin.head,reviewedCommit:reviewedHead,defects:ledger,
        resolutionPolicy:'For every OPEN known software ID and every device ID, return a current-source resolution with evidence and regression_test. Reuse IDs, report new defects with a new stable ID, never copy old reports as current evidence. A persists resolution MUST also appear in findings. Only true external checks may use device_required; software omissions remain findings. Disputed requires concrete counter-evidence. Do not claim to have run tests that did not run.',
        authorPolicy:plan?.escalated.length?'Codex authored the escalations and is NOT an eligible approver. You are the independent QA AND architecture verifier for the combined patch. Verify each Codex fix and regression; no self-approval.':'Codex and Claude both independently approve DeepSeek changes.' }), cycle)));
      if(ledger)validateResolutions(reviews.at(-1),ledger);
      reviews.at(-1).role=role;
      state = inspect();
      if (state.branch !== origin.branch || state.head !== reviewedHead || state.digest !== reviewed) throw Error('Reviewer modified workspace');
    }
    const tests = await execute('tests', '', cycle);
    state = inspect();
    if (state.branch !== origin.branch || state.head !== reviewedHead || state.digest !== reviewed) throw Error('Checks modified reviewed source; verification invalid');
    if (!Array.isArray(tests) || !tests.length || tests.some(t => typeof t.pass !== 'boolean' || !t.name)) throw Error('Missing test evidence');
    // Deferred checks (e.g. macOS-only native Apple gates on Windows) are
    // recorded but never sent back for repair; they block full VERIFIED.
    const deferred = tests.filter(t => t.deferred);
    // Deduplicate exact evidence only; preserve the highest severity.
    const findings = new Map();
    for (const f of reviews.flatMap(r => r.findings)) {
      const key = JSON.stringify([f.location,f.evidence,f.required_fix]);
      if (!findings.has(key) || f.severity < findings.get(key).severity) findings.set(key,f);
    }
    feedback = [...findings.values()].sort((a,b) => a.severity.localeCompare(b.severity));
    feedback.push(...tests.filter(t => !t.pass && !t.deferred));
    if(ledger){
      ledger=reconcile(ledger,reviews,{revision:reviewedHead+':'+reviewed,actors});
      feedback=[...blocking(ledger),...tests.filter(t=>!t.pass && !t.deferred)];
    }
    history.push({ cycle, reviews, tests, feedback, deferred, digest: reviewed,reviewedCommit:reviewedHead,actors,approvers,ledger });
    const externalGates=ledger?.filter(d=>d.kind==='device')||[];
    const finalStatus = feedback.length ? 'REPAIR_REQUIRED' : (deferred.length||externalGates.length ? 'PARTIAL_DEFERRED' : 'VERIFIED');
    persist({ status: finalStatus, history,ledger });
    if (!feedback.length) return { status: finalStatus, history,ledger };
  }
  return { status: 'BLOCKED', reason: 'Retry limit exhausted', history,ledger };
}
export async function lifecycle(options) {
  try {
    const result = await runLifecycle(options);
    options.persist?.(result);
    return result;
  } catch (error) {
    options.persist?.({ status: 'BLOCKED', reason: error.message });
    throw error;
  }
}
export function platformTestCommands(platform = process.platform) {
  return [['npm',['run','check']], ...(nativeCheckPolicy(platform).runnable ? [['npm',['run','test:native']]] : [])];
}
export async function preflight(root, signal) {
  const checks = [['cline',['--help'],['--provider','--model','--yolo','--json','--retries','--timeout']],
    ['codex',['exec','--help'],['--ignore-user-config','--sandbox','--output-schema','--output-last-message']],
    ['claude',['--help'],['--restricted','--tools','--json-schema','--permission-mode']]];
  const reports = [];
  for (const [cmd,args,flags] of checks) {
    const r = await executeProcess(cmd,args,{cwd:root,timeout:30000,limit:1024*1024,signal});
    const v = await executeProcess(cmd,['--version'],{cwd:root,timeout:30000,limit:1024*1024,signal});
    reports.push({cmd,version:v.stdout.trim(),compatibleHelp:r.code === 0 && v.code === 0 && flags.every(f => r.stdout.includes(f)),
      authentication:'NOT_TESTED',error:r.code !== 0 ? r.stderr.slice(0,1000) : undefined,helpHash:hash(r.stdout)});
  }
  return reports;
}
export function integrationEvidence(history) {
  const first = history?.[0];
  if (!first || first.reviews?.length !== 2 || first.reviews.some(r => r.pass ||
      !r.findings.some(f => /subtract|a\s*-\s*b/i.test(f.evidence+' '+f.required_fix))) ||
      !first.tests?.some(t => !t.pass)) throw Error('Integration did not prove both reviewers detected the seeded subtraction defect and the first tests failed');
}
export function deepseekProfile(home = homeDir()) {
  const path = join(home,'.cline/data/settings/providers.json');
  if (!existsSync(path)) throw Error('Missing Cline provider settings. Run cline auth deepseek.');
  const settings = JSON.parse(readFileSync(path,'utf8')).providers?.deepseek?.settings;
  if (settings?.provider !== 'deepseek' || !/^deepseek-[a-z0-9.-]+$/.test(settings.model || '') || !settings.apiKey) {
    throw Error('Missing authenticated direct DeepSeek profile. Run cline auth deepseek and choose a DeepSeek model.');
  }
  return { provider:'deepseek',model:settings.model };
}
async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!['--preflight','--dry-run','--run','--integration-test'].includes(mode)) throw Error('Usage: ai-orchestrate.mjs --preflight | --dry-run --task-file FILE | --run --task-file FILE | --integration-test');
  const root = process.cwd();
  if (mode === '--preflight') {
    const reports = await preflight(root);
    console.log(JSON.stringify({ reports, deepseek:deepseekProfile() },null,2));
    if (reports.some(r => !r.compatibleHelp)) process.exitCode = 1;
    return;
  }
  const defectIndex=args.indexOf('--defects-file');
  let defects;
  if(defectIndex>=0){
    const file=args[defectIndex+1];if(!file||file.startsWith('--'))throw Error('Missing defects file');
    const value=JSON.parse(readFileSync(resolve(file),'utf8'));defects=validateLedger(value.defects||value);
    args.splice(defectIndex,2);
  }
  const integration = mode === '--integration-test';
  if (integration ? args.length : args.length !== 2 || args[0] !== '--task-file') throw Error('Expected --task-file FILE (no arguments for --integration-test)');
  const task = integration ? 'Create addition.cjs in the current directory. Export a CommonJS function add(a,b) that returns a+b for finite numbers, including negatives and zero. Only edit addition.cjs. Do not commit. The external test harness must pass. Do not modify any test or orchestrator logs.' : readFileSync(resolve(args[1]),'utf8');
  if (!task.trim()) throw Error('Empty requirements');
  const maxCycles = bounded(process.env.AI_MAX_CYCLES,5,5);
  const timeout = bounded(process.env.AI_STEP_TIMEOUT_SECONDS,900,5400)*1000;
  const branch = git(root,'branch','--show-current');
  if (!branch || ['main','master'].includes(branch)) throw Error('Isolated feature branch required');
  if (resolve(root,git(root,'rev-parse','--git-common-dir')) === resolve(root,git(root,'rev-parse','--git-dir'))) throw Error('Run in an isolated linked Git worktree');
  if (mode === '--run' && git(root,'status','--porcelain')) throw Error('Working tree must be clean; commit local work before starting');
  const base = git(root,'rev-parse','HEAD');
  const dir = join(root,'.build','ai-orchestrator',new Date().toISOString().replace(/[:.]/g,'-'));
  mkdirSync(dir,{ recursive:true,mode:0o700 });
  const save = (file,value) => writeFileSync(join(dir,file),typeof value === 'string' ? value : JSON.stringify(value,null,2),{mode:0o600});
  const outputSchema=defects?trackedSchema(schema):schema;
  save('requirements.md',task); save('review-schema.json',outputSchema);
  const report = { status:mode === '--dry-run' ? 'DRY_RUN' : 'RUNNING', branch,base,root,
    requirementsHash:hash(task),requirementsBytes:Buffer.byteLength(task),maxCycles,timeoutSeconds:timeout/1000,
    realAgentsExecuted:false,executions:[],history:[],integration,
    limitations:['Local trusted CLI execution; worktree is not an OS sandbox','Timeouts and cycle limits are not monetary limits','No simulator or hardware acceptance implied'] };
  const persist = value => {
    Object.assign(report,value);
    if (integration && value.history?.length) integrationEvidence(value.history);
    save('summary.json',report);
    if(value.ledger)save('defects.json',{version:1,defects:value.ledger});
  };
  persist({});
  if (mode === '--dry-run') { console.log(JSON.stringify({...report,artifacts:dir},null,2)); return; }
  const lock = join(root,'.build','ai-orchestrator','active.lock');
  let lockFd;
  try { lockFd = openSync(lock,'wx',0o600); writeFileSync(lockFd,String(process.pid)); }
  catch {
    const reason = 'Another run holds '+lock+'; if interrupted, verify its PID has exited before removing the stale lock';
    persist({status:'BLOCKED',reason}); throw Error(reason);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const cancelMessage = message => { if(message?.type==='cancel')cancel(); };
  process.once('SIGINT',cancel); process.once('SIGTERM',cancel); process.once('SIGBREAK',cancel);
  process.on('message',cancelMessage);
  try {
    const checks = await preflight(root,controller.signal);
    save('preflight.json',checks);
    if (checks.some(c => !c.compatibleHelp)) throw Error('CLI preflight failed; see preflight.json');
    if(process.platform==='win32')throw Error('Windows automatic agent execution remains BLOCKED pending independent approval of process containment; preflight is diagnostic only');
    const profile = deepseekProfile(); persist({deepseek:profile});
    if (!integration) {
      const scripts = JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts;
      if (!scripts?.check || !scripts?.['test:native']) throw Error('Required npm scripts check and test:native are unavailable');
    }
    const cwd = integration ? join(dir,'fixture') : root;
    if (integration) mkdirSync(cwd);
    const inspect = () => ({ branch:git(root,'branch','--show-current'),head:git(root,'rev-parse','HEAD'),
      digest:integration ? hash(existsSync(join(cwd,'addition.cjs')) ? readFileSync(join(cwd,'addition.cjs')) : 'missing') : snapshot(root) });
    const run = async (cmd,argv,label,input = '') => {
      console.log(label+': starting');
      const entry = {label,cmd,argv,started:new Date().toISOString()};
      report.executions.push(entry); persist({});
      let result;
      try { result = await executeProcess(cmd,argv,{cwd,input,timeout,signal:controller.signal}); }
      catch (error) { result = error.result || {code:null,error:error.message,stdout:'',stderr:''}; }
      save(label+'.log',(result.stdout || '')+'\n--- STDERR ---\n'+(result.stderr || ''));
      Object.assign(entry,{code:result.code,error:result.error,signal:result.signal,finished:new Date().toISOString()});
      persist({}); console.log(label+': '+(result.error || 'exit '+result.code));
      if (result.error) throw Error(label+': '+result.error);
      return result;
    };
    const execute = async (role,prompt,cycle) => {
      if (role === 'tests') {
        const native = nativeCheckPolicy();
        const tests = integration ? [[process.execPath,['-e',
          "const assert=require('node:assert/strict');const add=require('./addition.cjs');for(const [a,b] of [[2,3],[-2,3],[0,0],[-0,-0],[1.5,2.5],[Number.MAX_VALUE,Number.MAX_VALUE]]) assert.equal(add(a,b),a+b);"]]] : platformTestCommands();
        const results = [];
        for (const [cmd,argv] of tests) {
          const label = 'tests-'+cycle+'-'+results.length;
          const r = await run(cmd,argv,label);
          if (r.signal || r.code === null || r.code === 127) throw Error('Required tests could not run: '+label);
          results.push({name:cmd+' '+argv.join(' '),pass:r.code === 0,log:join(dir,label+'.log'),evidence:(r.stdout+'\n'+r.stderr).slice(-12000)});
        }
        // Explicit partial-Windows policy: native Apple checks are deferred to
        // macOS and recorded (never silently skipped) so Windows runs cannot
        // claim full VERIFIED for Swift/Xcode/iOS/Watch work.
        if (!integration) {
          if (!native.runnable) results.push({ name:native.name, pass:false, deferred:true, reason:native.reason });
        }
        return results;
      }
      const label = role+'-'+cycle;
      const output = join(dir,label+(role==='escalation'?'.txt':'.json'));
      save(label+'-prompt.json',prompt);
      const [cmd,argv] = commands(role,output,join(dir,'review-schema.json'),profile.model,timeout/1000,outputSchema);
      const authorBase=['developer','escalation'].includes(role)?git(root,'rev-parse','HEAD'):null;
      report.realAgentsExecuted = true;
      const result = await run(cmd,argv,label,prompt);
      if (result.code !== 0) throw Error(label+' failed; see '+label+'.log');
      if (role === 'developer'||role==='escalation') {
        const changedFiles=[git(root,'diff',authorBase,'--name-only'),git(root,'ls-files','--others','--exclude-standard')].join('\n').split('\n').filter(Boolean);
        report.executions.at(-1).sourceBefore=authorBase;
        report.executions.at(-1).changedFiles=[...new Set(changedFiles)];
        persist({});
        if(role==='escalation'){
          const assigned=JSON.parse(prompt).assignedDefects;
          const changed=[git(root,'diff',authorBase,'--name-only'),git(root,'ls-files','--others','--exclude-standard')].join('\n').split('\n').filter(Boolean);
          assertEscalationScope([...new Set(changed)],assigned);
          if(git(root,'diff',authorBase,'--diff-filter=D','--name-only'))throw Error('Escalation deleted existing files');
        }
        if (integration && role==='developer' && cycle === 1) {
          if (!existsSync(join(cwd,'addition.cjs'))) throw Error('Cline did not implement fixture');
          save('fixture-before-injection.cjs',readFileSync(join(cwd,'addition.cjs'),'utf8'));
          writeFileSync(join(cwd,'addition.cjs'),'module.exports = (a,b) => a-b;\n');
          save('injected-defect.json',{cycle,reason:'Controlled subtraction defect injected after real Cline implementation, before both independent reviews and executable tests'});
        }
        return {changedFiles:report.executions.at(-1).changedFiles};
      }
      const raw = role === 'codex' ? readFileSync(output,'utf8') : claudeVerdict(result.stdout);
      save(label+'.json',verdict(raw));
      return raw;
    };
    const checkpoint=(_,cycle)=>{
      if(integration)return;
      if(git(root,'branch','--show-current')!==branch)throw Error('Branch changed before checkpoint');
      if(git(root,'status','--porcelain')){
        git(root,'add','--all');
        git(root,'commit','-m','AI source checkpoint for independent review, cycle '+cycle);
      }
    };
    const result = await lifecycle({task,maxCycles,execute,inspect,persist,defects,checkpoint});
    persist({...result,finished:new Date().toISOString()});
    if (result.status !== 'VERIFIED') process.exitCode = 1;
  } catch (error) {
    persist({status:'BLOCKED',reason:error.message,finished:new Date().toISOString()});
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT',cancel); process.removeListener('SIGTERM',cancel); process.removeListener('SIGBREAK',cancel);
    process.removeListener('message',cancelMessage);
    closeSync(lockFd); unlinkSync(lock);
  }
  console.log(report.status+': '+(report.reason || 'Inspect actual approvers, test results and deferred gates in the report')+'; report: '+join(dir,'summary.json'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error('BLOCKED: '+e.message); process.exitCode = 1;
});
