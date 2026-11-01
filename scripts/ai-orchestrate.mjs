#!/usr/bin/env node
// Local-only AI development loop. No push, merge, deployment or remote SQL.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const promptIndex = args.indexOf('--prompt-file');
const promptPath = promptIndex >= 0 ? args[promptIndex + 1] : null;
const task = promptPath ? readFileSync(resolve(promptPath), 'utf8').trim() :
  args.filter((a,i) => !a.startsWith('--') && i !== promptIndex + 1).join(' ').trim();
const dryRun = args.includes('--dry-run');
const ios = args.includes('--ios');
const maxCycles = Number(process.env.AI_MAX_CYCLES || 3);
const maxMinutes = Number(process.env.AI_STEP_TIMEOUT_MINUTES || 30);
if (!task || task.length > 150000 || !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 5 ||
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
  if (!dryRun && git('status', '--porcelain')) throw new Error('Working tree must be clean before starting. Use an isolated git worktree to preserve unrelated changes.');
  if (!dryRun) {
    for (const cmd of ['cline', 'codex', 'claude', 'npm']) {
      const r = spawnSync('which', [cmd], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(cmd + ' CLI not found on PATH.');
    }
  }
  if (dryRun) {
    console.log('DRY RUN: would run Cline (configured DeepSeek), Codex architecture review, Claude QA review, web/native checks' + (ios ? ', and unsigned iOS build' : '') + '. No agent commands run.');
    save(); process.exit(0);
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
  writeFileSync(join(dir, 'task.md'), task);
  let feedback = '';
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    console.log('Cycle ' + cycle + '/' + maxCycles);
    const prompt = guard + '\nTask: ' + task +
      '\nImplement through Cline using the configured DeepSeek model. Add targeted regression tests. ' +
      (feedback ? '\nFix these independently verified issues and test failures:\n' + feedback : '') +
      '\nDo not declare success without running available checks.';
    const implement = run('cline', ['--auto-approve','true',prompt], 'cline-' + cycle);
    if (implement.status !== 0 || implement.error) throw new Error('Cline failed. See run logs.');
    if (git('branch', '--show-current') !== branch) throw new Error('Cline changed the active branch; stopping.');
    const diff = git('diff', base, 'HEAD', '--stat') + '\n' + git('status', '--short');
    if (!diff.trim()) throw new Error('No implementation changes detected.');
    const reviewOut = join(dir, 'review-' + cycle + '.json');
    const reviewPrompt = guard + '\nReview against ALL original requirements:\n' + task + '\nINDEPENDENT READ-ONLY architecture, correctness, security and integration review. ' +
      'Review all changed files AND directly affected call chains, tests and configuration. ' +
      'Base commit: ' + base + '. Task: ' + task + '. Only pass=true if there are no actionable findings. ' +
      'List reproducible findings with concrete evidence and locations. Do not edit any files.';
    const review = run('codex', ['exec','--sandbox','read-only','--output-schema',schemaPath,'--output-last-message',reviewOut,reviewPrompt], 'codex-review-' + cycle);
    if (review.status !== 0 || review.error || !existsSync(reviewOut)) throw new Error('Codex review failed or missing structured report.');
    if (git('branch', '--show-current') !== branch) throw new Error('Branch changed during review; stopping.');
    let verdict;
    try { verdict = JSON.parse(readFileSync(reviewOut,'utf8')); }
    catch { throw new Error('Invalid Codex review JSON.'); }
    if (typeof verdict.pass !== 'boolean' || !Array.isArray(verdict.findings)) throw new Error('Incomplete Codex review result.');
    // Independent Claude QA review; text output must parse as the same fail-closed schema.
    // The VS Code Claude Code extension can supply the 'claude' command when installed.
    const claudePrompt = guard + '\nReview against ALL original requirements:\n' + task + '\nIndependent QA and risk review; do not modify files or execute commands. ' +
      'Task: ' + task + '. Base commit: ' + base + '. Examine affected code and integration paths, missing test coverage, ' +
      'edge cases, iOS/watchOS lifecycle, GPS accuracy, privacy, UX regressions and potential concurrency bugs as applicable. ' +
      'The implementation diff/statistics: ' + diff.slice(0, 10000) + '. ' +
      'Return ONLY a JSON object with pass (boolean), summary (string), findings (array), ' +
      'each finding containing severity (P0/P1/P2/P3), location, evidence and required_fix (all strings). ' +
      'pass=true only with zero actionable findings. If insufficient evidence, pass=false with an explicit finding.';
    const beforeClaude = git('status','--porcelain');
    const claude = run('claude', [
      '-p', '--permission-mode', 'plan', '--disallowedTools', 'Edit,Write,NotebookEdit,Bash',
      '--output-format', 'text', '--max-turns', '15', claudePrompt
    ], 'claude-qa-' + cycle);
    if (claude.status !== 0 || claude.error) throw new Error('Claude QA failed. See run logs.');
    if (git('branch', '--show-current') !== branch || git('status','--porcelain') !== beforeClaude) {
      throw new Error('Claude reviewer changed files or branch; stopping.');
    }
    let claudeVerdict;
    try {
      claudeVerdict = JSON.parse(claude.stdout.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/g, ''));
    } catch { throw new Error('Claude QA did not return valid JSON; cannot mark as passed.'); }
    if (typeof claudeVerdict.pass !== 'boolean' || !Array.isArray(claudeVerdict.findings) ||
        typeof claudeVerdict.summary !== 'string' ||
        claudeVerdict.findings.some(f => !['P0','P1','P2','P3'].includes(f.severity) ||
          !['location','evidence','required_fix'].every(k => typeof f[k] === 'string' && f[k]))) {
      throw new Error('Incomplete Claude QA review; cannot mark as passed.');
    }
    writeFileSync(join(dir, 'claude-review-' + cycle + '.json'), JSON.stringify(claudeVerdict,null,2));
    const tests = [['npm',['run','check']], ['npm',['run','test:native']]];
    if (ios) tests.push(['npm',['run','ios:sync']], ['npm',['run','ios:build']]);
    const failures = [];
    for (let i=0;i<tests.length;i++) {
      const [cmd,a] = tests[i];
      const r = run(cmd,a,'test-'+cycle+'-'+i);
      if (r.status !== 0 || r.error) failures.push(cmd+' '+a.join(' ')+' failed; see test log test-'+cycle+'-'+i);
    }
    if (verdict.pass && verdict.findings.length === 0 && claudeVerdict.pass && claudeVerdict.findings.length === 0 && failures.length === 0) {
      console.log('PASS: independent review and configured checks. Hardware and UX acceptance still needed.');
      save(); process.exit(0);
    }
    feedback = JSON.stringify({ codexReview: verdict, claudeReview: claudeVerdict, failures }, null, 2);
    writeFileSync(join(dir, 'feedback-'+cycle+'.json'), feedback);
    if (cycle === maxCycles) break;
  }
  console.error('STOP: did not pass after '+maxCycles+' cycles. See '+dir);
  save(); process.exit(1);
} catch(e) {
  console.error('STOP: '+e.message);
  save(); process.exit(1);
}
