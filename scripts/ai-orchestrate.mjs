#!/usr/bin/env node
// Local-only AI development loop. No push, merge, deployment or remote SQL.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const task = args.filter(a => !a.startsWith('--')).join(' ').trim();
const dryRun = args.includes('--dry-run');
const ios = args.includes('--ios');
const maxCycles = Number(process.env.AI_MAX_CYCLES || 3);
const maxMinutes = Number(process.env.AI_STEP_TIMEOUT_MINUTES || 30);
if (!task || !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 5 ||
    !Number.isFinite(maxMinutes) || maxMinutes < 1 || maxMinutes > 90) {
  console.error('Usage: node scripts/ai-orchestrate.mjs [--dry-run] [--ios] "feature description"');
  process.exit(2);
}
const out = resolve(root, '.build/ai-orchestrator');
mkdirSync(out, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(out, runId);
mkdirSync(dir);
const log = [];
function run(cmd, argv, label, { timeout = maxMinutes * 60000 } = {}) {
  const info = { label, cmd, argv, started: new Date().toISOString() };
  log.push(info);
  if (dryRun) { console.log('[DRY RUN]', cmd, argv.join(' ')); info.exit = 0; return { status: 0, stdout: '', stderr: '' }; }
  const r = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: process.env });
  info.exit = r.status;
  info.error = r.error?.message;
  writeFileSync(join(dir, label.replace(/[^a-zA-Z0-9_-]/g, '_') + '.log'),
    (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '') + '\n' + (r.error?.message || ''));
  console.log(label + ': ' + (r.error ? 'ERROR ' + r.error.message : 'exit ' + r.status));
  return r;
}
function git(...a) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
function save() { writeFileSync(join(dir, 'summary.json'), JSON.stringify({ task, branch, log }, null, 2)); }
let branch;
try {
  branch = git('branch', '--show-current');
  if (!branch || ['main','master'].includes(branch)) throw new Error('Start from an isolated feature branch, not main.');
  if (git('status', '--porcelain')) throw new Error('Working tree must be clean before starting.');
  if (!dryRun) {
    for (const cmd of ['cline', 'codex', 'npm']) {
      const r = spawnSync('which', [cmd], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(cmd + ' CLI not found on PATH.');
    }
  }
  const base = git('merge-base', 'HEAD', 'main');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'summary', 'findings'],
    properties: {
      pass: { type: 'boolean' },
      summary: { type: 'string' },
      findings: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['severity','location','evidence','required_fix'],
        properties: {
          severity: { type:'string', enum:['P0','P1','P2','P3'] },
          location: { type:'string' }, evidence: { type:'string' }, required_fix: { type:'string' }
        }
      } }
    }
  };
  const schemaPath = join(dir, 'review-schema.json');
  writeFileSync(schemaPath, JSON.stringify(schema));
  const guard = 'Work only in the current isolated branch. Do not push, merge, deploy, edit remote services, run remote SQL, or change production data. Do not disable tests to pass. No secrets in output. Preserve unrelated work.';
  let feedback = '';
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    console.log('Cycle ' + cycle + '/' + maxCycles);
    const prompt = guard + '\nTask: ' + task +
      '\nImplement through Cline using the configured DeepSeek model. Add targeted regression tests. ' +
      (feedback ? '\nFix these independently verified issues and test failures:\n' + feedback : '') +
      '\nDo not declare success without running available checks.';
    const implement = run('cline', ['--auto-approve','true',prompt], 'cline-' + cycle);
    if (implement.status !== 0 || implement.error) throw new Error('Cline failed. See run logs.');
    const diff = git('diff', base, 'HEAD', '--stat') + '\n' + git('status', '--short');
    if (!diff.trim()) throw new Error('No implementation changes detected.');
    const reviewOut = join(dir, 'review-' + cycle + '.json');
    const reviewPrompt = guard + '\nINDEPENDENT READ-ONLY architecture, correctness, security and integration review. ' +
      'Review all changed files AND directly affected call chains, tests and configuration. ' +
      'Base commit: ' + base + '. Task: ' + task + '. Only pass=true if there are no actionable findings. ' +
      'List reproducible findings with concrete evidence and locations. Do not edit any files.';
    const review = run('codex', ['exec','--sandbox','read-only','--output-schema',schemaPath,'--output-last-message',reviewOut,reviewPrompt], 'codex-review-' + cycle);
    if (review.status !== 0 || review.error || !existsSync(reviewOut)) throw new Error('Codex review failed or missing structured report.');
    let verdict;
    try { verdict = JSON.parse(readFileSync(reviewOut,'utf8')); }
    catch { throw new Error('Invalid Codex review JSON.'); }
    if (typeof verdict.pass !== 'boolean' || !Array.isArray(verdict.findings)) throw new Error('Incomplete Codex review result.');
    const tests = [['npm',['run','check']], ['npm',['run','test:native']]];
    if (ios) tests.push(['npm',['run','ios:sync']], ['npm',['run','ios:build']]);
    const failures = [];
    for (let i=0;i<tests.length;i++) {
      const [cmd,a] = tests[i];
      const r = run(cmd,a,'test-'+cycle+'-'+i);
      if (r.status !== 0 || r.error) failures.push(cmd+' '+a.join(' ')+' failed; see test log test-'+cycle+'-'+i);
    }
    if (verdict.pass && verdict.findings.length === 0 && failures.length === 0) {
      console.log('PASS: independent review and configured checks. Hardware and UX acceptance still needed.');
      save(); process.exit(0);
    }
    feedback = JSON.stringify({ review: verdict, failures }, null, 2);
    writeFileSync(join(dir, 'feedback-'+cycle+'.json'), feedback);
    if (cycle === maxCycles) break;
  }
  console.error('STOP: did not pass after '+maxCycles+' cycles. See '+dir);
  save(); process.exit(1);
} catch(e) {
  console.error('STOP: '+e.message);
  save(); process.exit(1);
}
