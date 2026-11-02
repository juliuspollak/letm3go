import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWindows, windowsEnvironment, homeDir, resolveOnPath, resolveCommand, parseWindowsCmdShim, nativeClaudeCandidates, nativeCheckPolicy } from '../../scripts/ai-launcher.mjs';
import { executeProcess } from '../../scripts/ai-orchestrate.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitFor(fn, ms) { const start = Date.now(); while (!fn() && Date.now() - start < ms) await new Promise(r => setTimeout(r, 20)); }

test('homeDir falls back from HOME to USERPROFILE', () => {
  assert.equal(homeDir({ HOME: '/home/u' }), '/home/u');
  assert.equal(homeDir({ USERPROFILE: 'C:\\Users\\u' }), 'C:\\Users\\u');
  assert.equal(homeDir({ HOME: '', USERPROFILE: 'C:\\Users\\u' }), 'C:\\Users\\u');
  assert.equal(homeDir({}), '');
});

test('windowsEnvironment forwards minimal Windows vars and adds HOME fallback', { skip: !isWindows() }, () => {
  const env = windowsEnvironment({ USERPROFILE: 'C:\\Users\\u', APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', TEMP: 'C:\\Temp', TMP: 'C:\\Temp', SystemRoot: 'C:\\Windows',
    PATHEXT: '.COM;.EXE;.BAT;.CMD' });
  assert.equal(env.USERPROFILE, 'C:\\Users\\u');
  assert.equal(env.HOME, 'C:\\Users\\u');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.PATHEXT, '.COM;.EXE;.BAT;.CMD');
});

test('resolves an npm cmd-shim to its Node entry without cmd interpolation', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-shim-'));
  const entry = join(dir, 'node_modules', 'cli', 'bin', 'cli.js');
  mkdirSync(join(dir, 'node_modules', 'cli', 'bin'), { recursive: true });
  writeFileSync(entry, '#!/usr/bin/env node\n');
  writeFileSync(join(dir, 'cli.cmd'), [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
    'CALL :find_dp0', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (',
    '  SET "_prog=node"', ')',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\cli\\bin\\cli.js" %*',
    '',
  ].join('\r\n'));
  const env = { PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const resolved = resolveCommand('cli', ['arg one', 'a&b', 'x|y;z'], env);
  assert.equal(resolved.file, process.execPath);
  assert.deepEqual(resolved.args.slice(0, 1), [entry]);
  assert.deepEqual(resolved.args.slice(1), ['arg one', 'a&b', 'x|y;z']);
  assert.equal(parseWindowsCmdShim(join(dir, 'cli.cmd')).file, process.execPath);
});

test('launcher argv passes cmd metacharacters verbatim, not through a shell', { skip: !isWindows() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-injection-'));
  const entry = join(dir, 'node_modules', 'tool', 'bin', 'tool.js');
  mkdirSync(join(dir, 'node_modules', 'tool', 'bin'), { recursive: true });
  writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  writeFileSync(join(dir, 'tool.cmd'), [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
    'CALL :find_dp0',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\bin\\tool.js" %*',
    '',
  ].join('\r\n'));
  const payload = ['hello world', 'a & b', 'x|y', 'c;d>e', '$HOME'];
  const r = await executeProcess('tool', payload, { cwd: dir, timeout: 30000, env: { PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD', HOME: dir, USERPROFILE: dir, SystemRoot: process.env.SystemRoot } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), payload);
});

test('resolves npm.cmd format to npm-cli.js', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-npm-'));
  const cli = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  mkdirSync(join(dir, 'node_modules', 'npm', 'bin'), { recursive: true });
  writeFileSync(cli, '#!/usr/bin/env node\n');
  writeFileSync(join(dir, 'npm.cmd'), [
    ':: Created by npm, please don\'t edit manually.', '@ECHO OFF', '', 'SETLOCAL', '',
    'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ')', '',
    'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
    'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
    'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (',
    '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"', ')',
    'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (', '  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"', ')', '',
    '"%NODE_EXE%" "%NPM_CLI_JS%" %*', '',
  ].join('\r\n'));
  const resolved = resolveCommand('npm', ['run', 'check'], { PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' });
  assert.equal(resolved.file, process.execPath);
  assert.deepEqual(resolved.args, [cli, 'run', 'check']);
});

test('resolves a direct exe launcher shim without running node', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-exe-shim-'));
  const exe = join(dir, 'node_modules', 'pkg', 'bin', 'tool.exe');
  mkdirSync(join(dir, 'node_modules', 'pkg', 'bin'), { recursive: true });
  writeFileSync(exe, 'MZ');
  writeFileSync(join(dir, 'tool.cmd'), ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
    'CALL :find_dp0', 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\node_modules\\pkg\\bin\\tool.exe" %*', '',
  ].join('\r\n'));
  const resolved = resolveCommand('tool', ['arg one'], { PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' });
  assert.equal(resolved.file, exe);
  assert.deepEqual(resolved.args, ['arg one']);
});

test('preserves node flags between node and the JS entry', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-node-flags-'));
  const entry = join(dir, 'node_modules', 'cli', 'bin', 'cli.js');
  mkdirSync(join(dir, 'node_modules', 'cli', 'bin'), { recursive: true });
  writeFileSync(entry, '#!/usr/bin/env node\n');
  writeFileSync(join(dir, 'cli.cmd'), ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
    'CALL :find_dp0', 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\node.exe" "--trace-warnings" "%dp0%\\node_modules\\cli\\bin\\cli.js" %*', '',
  ].join('\r\n'));
  const resolved = resolveCommand('cli', ['run'], { PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' });
  assert.equal(resolved.file, process.execPath);
  assert.deepEqual(resolved.args, ['--trace-warnings', entry, 'run']);
});

test('refuses unsupported interpreter shims instead of invoking a shell', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-unsupported-'));
  const script = join(dir, 'script.py');
  writeFileSync(script, 'print(1)');
  writeFileSync(join(dir, 'tool.cmd'), ['@ECHO off', 'python.exe "%dp0%\\script.py" %*', '',
  ].join('\r\n'));
  assert.throws(() => resolveCommand('tool', [], { PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }), /unsupported launcher shim/);
});

test('refuses non-executable PATHEXT matches instead of spawning them', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-non-exec-'));
  writeFileSync(join(dir, 'tool.js'), 'process.exit(1);');
  assert.throws(() => resolveCommand('tool', [], { PATH: dir, Path: dir, PATHEXT: '.JS' }), /non-executable/);
});

test('discovers native Claude exe from override and known locations', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-claude-'));
  const exe = join(dir, 'claude.exe');
  writeFileSync(exe, 'MZ');
  assert.deepEqual(nativeClaudeCandidates({ CLAUDE_BINARY: exe, HOME: dir }), [exe]);
  const local = join(dir, 'Local');
  const known = join(local, 'Programs', 'claude', 'claude.exe');
  mkdirSync(join(local, 'Programs', 'claude'), { recursive: true });
  writeFileSync(known, 'MZ');
  assert.ok(nativeClaudeCandidates({ LOCALAPPDATA: local, HOME: dir, USERPROFILE: dir }).includes(known));
  assert.equal(resolveCommand('claude', ['-p'], { CLAUDE_BINARY: exe, HOME: dir, PATH: '', Path: '', PATHEXT: '.COM;.EXE' }).file, exe);
});

test('refuses PowerShell shims instead of invoking a shell', { skip: !isWindows() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-ps1-'));
  writeFileSync(join(dir, 'tool.ps1'), '# powershell');
  assert.throws(() => resolveCommand('tool', [], { PATH: dir, Path: dir, PATHEXT: '.PS1' }), /PowerShell/);
});

test('real npm resolves and runs --version without cmd.exe', { skip: !isWindows() || !resolveOnPath('npm') }, async () => {
  const r = await executeProcess('npm', ['--version'], { cwd: tmpdir(), timeout: 60000 });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('native check policy is explicit and never silently skipped', () => {
  if (isWindows()) {
    const p = nativeCheckPolicy();
    assert.equal(p.runnable, false);
    assert.match(p.reason, /macOS/);
    assert.equal(p.name, 'npm run test:native');
  } else {
    assert.equal(nativeCheckPolicy().runnable, true);
  }
});

function descendantParent(marker) {
  return `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid));
    setInterval(()=>{},1000);
  `;
}

test('executeProcess timeout terminates the whole descendant tree', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-tree-timeout-'));
  const marker = join(dir, 'grandchild.pid');
  await assert.rejects(executeProcess(process.execPath, ['-e', descendantParent(marker)], { cwd: dir, timeout: 30000 }), /Timeout/);
  await waitFor(() => existsSync(marker), 2000);
  const pid = Number(readFileSync(marker, 'utf8'));
  assert.ok(pid > 0);
  await waitFor(() => !isAlive(pid), 5000);
  assert.equal(isAlive(pid), false, 'descendant must be terminated with its parent');
});

test('executeProcess abort terminates the whole descendant tree', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-tree-abort-'));
  const marker = join(dir, 'grandchild.pid');
  const controller = new AbortController();
  const p = executeProcess(process.execPath, ['-e', descendantParent(marker)], { cwd: dir, signal: controller.signal });
  await waitFor(() => existsSync(marker), 3000);
  controller.abort();
  await assert.rejects(p, /Cancelled/);
  const pid = Number(readFileSync(marker, 'utf8'));
  assert.ok(pid > 0);
  await waitFor(() => !isAlive(pid), 5000);
  assert.equal(isAlive(pid), false, 'descendant must be terminated with its parent');
});
