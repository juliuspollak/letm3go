// Windows-portability boundary for the local three-agent runner.
//
// npm installs cline/codex/npm on Windows as .cmd shims that cannot be spawned
// without a shell. This module resolves those shims to their real Node entry
// points (and discovers native Claude exe installs) so the runner can use
// spawn() with an argv array instead of shell=true or cmd.exe interpolation.
// It also terminates whole process trees on Windows via taskkill.exe.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

export const isWindows = () => process.platform === 'win32';

// Minimal, deterministic Windows environment that the runner forwards to CLIs,
// with a HOME fallback so tools resolving ~/.cline or ~/.config keep working.
export function windowsEnvironment(env = process.env) {
  const keys = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'SystemDrive',
    'ComSpec', 'ProgramFiles', 'ProgramFiles(x86)', 'PROCESSOR_ARCHITECTURE', 'OS', 'PATHEXT', 'windir',
    'ALLUSERSPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME'];
  const out = {};
  for (const key of keys) if (env[key]) out[key] = env[key];
  if (!out.HOME && out.USERPROFILE) out.HOME = out.USERPROFILE;
  return out;
}

// Platform-agnostic homedir: HOME on POSIX/macOS, USERPROFILE on Windows.
export function homeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || '';
}

export function windowsPathExtensions(env = process.env) {
  const raw = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toUpperCase().split(';').filter(Boolean);
  const seen = new Set();
  const exts = [];
  for (const ext of raw) {
    const e = ext.toLowerCase();
    if (!seen.has(e)) { seen.add(e); exts.push(e); }
  }
  return exts;
}

// PATHEXT-aware lookup of an executable on PATH. Returns an absolute path or null.
export function resolveOnPath(command, env = process.env) {
  if (!command) return null;
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? command : null;
  }
  const dirs = String(env.PATH || env.Path || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of windowsPathExtensions(env)) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
    const bare = join(dir, command);
    if (existsSync(bare)) return bare;
  }
  return null;
}

function nodeExeNear(dp0) {
  const local = join(dp0, 'node.exe');
  return existsSync(local) ? local : process.execPath;
}

function substituteVars(value, vars, dp0) {
  return value
    .replace(/%~dp0/gi, () => dp0)
    .replace(/%(dp0|~dp0)%/gi, () => dp0)
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name) => {
      const key = name.toLowerCase();
      return Object.hasOwn(vars, key) ? vars[key] : whole;
    });
}

// Split one `&`-separated command segment into argv, honouring double quotes.
function tokenizeCmd(command) {
  const tokens = [];
  const re = /"([^"]*)"|([^\s]+)/g;
  let m;
  while ((m = re.exec(command))) tokens.push(m[1] !== undefined ? m[1] : m[2]);
  return tokens;
}

// Parse a Windows .cmd/.bat launcher (npm cmd-shim or npm.cmd/npx.cmd format)
// and return a spawn()-safe { file, prepend } without running cmd.exe. Only
// Node launchers (explicit node + a real JS entry, preserving node flags) and
// direct .exe launchers are supported; every other interpreter, unresolved
// variable or shell construct fails closed (returns null).
export function parseWindowsCmdShim(cmdFile) {
  const dp0 = dirname(cmdFile);
  const text = readFileSync(cmdFile, 'utf8');
  const vars = {};
  let invocation = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const set = line.match(/^SET\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=\s*(.*)$/i);
    if (set) {
      let value = set[2].trim().replace(/^"|"$/g, '');
      value = substituteVars(value, vars, dp0);
      // Keep a previous, fully-resolved value when a later branch references a
      // variable that can only be computed at runtime (e.g. npm.cmd's FOR /F).
      if (!value.includes('%')) vars[set[1].toLowerCase()] = value;
    }
    if (line.includes('%*')) invocation = line;
  }
  if (!invocation) return null;
  // The program invocation is the final `&`-separated segment (the preceding
  // segments are SETLOCAL/endLocal/title scaffolding, never the program).
  const command = invocation.split('&').map(s => s.trim()).filter(Boolean).at(-1);
  if (!command) return null;
  const rawTokens = tokenizeCmd(command);
  const tokens = rawTokens.map(t => substituteVars(t, vars, dp0));
  // `%*` is the caller-argument placeholder and must be the final token.
  if (tokens.length < 2 || tokens.at(-1) !== '%*') return null;
  const argv = tokens.slice(0, -1);
  // Everything except the interpreter must resolve fully; the cmd-shim node
  // variable may legitimately be unset (its default is `node`).
  if (argv.slice(1).some(t => t.includes('%'))) return null;
  const interpreter = argv[0];
  const interpreterBase = basename(interpreter).toLowerCase();
  const shimNodeVar = /^%(?:_prog|node_exe)%$/i.test(rawTokens[0]);
  const nodeLike = interpreterBase === 'node' || interpreterBase === 'node.exe' || shimNodeVar;
  if (nodeLike) {
    // Node invocation: the last token is the JS entry; tokens in between are
    // Node flags that must be preserved verbatim.
    const entry = argv.at(-1);
    if (entry === interpreter || /\.(exe|com)$/i.test(entry)) return null;
    const resolvedEntry = resolve(dp0, entry);
    if (!existsSync(resolvedEntry)) return null;
    const nodeFile = /\.exe$/i.test(interpreter) && isAbsolute(interpreter) && existsSync(interpreter)
      ? interpreter : nodeExeNear(dp0);
    return { file: nodeFile, prepend: [...argv.slice(1, -1), resolvedEntry] };
  }
  // Direct launcher: the interpreter itself is the executable (never a shell).
  if (!/\.(exe|com)$/i.test(interpreter)) return null;
  const target = resolve(dp0, interpreter);
  if (!existsSync(target)) return null;
  return { file: target, prepend: argv.slice(1) };
}

// Native Claude Code installs (claude.exe) live outside npm on Windows.
export function nativeClaudeCandidates(env = process.env) {
  const overrides = [];
  for (const key of ['CLAUDE_BINARY', 'CLAUDE_EXE']) if (env[key]) overrides.push(env[key]);
  const h = homeDir(env);
  const local = env.LOCALAPPDATA || join(h, 'AppData', 'Local');
  const appdata = env.APPDATA || join(h, 'AppData', 'Roaming');
  return [
    ...overrides,
    join(local, 'Programs', 'claude', 'claude.exe'),
    join(h, '.local', 'bin', 'claude.exe'),
    join(h, '.claude', 'local', 'claude.exe'),
    join(appdata, 'npm', 'claude.exe'),
    join(local, 'claude', 'claude.exe'),
  ].filter(p => existsSync(p));
}

// Resolve a bare command to a spawn()-safe { file, args }. On POSIX the command
// is returned unchanged. On Windows, .exe/.com are used directly, npm-style
// .cmd/.bat shims are resolved structurally, and anything else (.ps1, .js,
// .vbs, extensionless scripts) is refused so no shell ever runs it.
export function resolveCommand(command, args = [], env = process.env) {
  if (!isWindows()) return { file: command, args: [...args] };
  let found = resolveOnPath(command, env);
  if (command.toLowerCase() === 'claude' && (!found || !/\.exe$/i.test(found))) {
    const native = nativeClaudeCandidates(env)[0];
    if (native) found = native;
  }
  if (!found) return { file: command, args: [...args] }; // let spawn surface ENOENT
  const lower = found.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    const parsed = parseWindowsCmdShim(found);
    if (!parsed) throw Error('Refusing to run ' + found + ' through cmd.exe; unsupported launcher shim for ' + command);
    return { file: parsed.file, args: [...parsed.prepend, ...args] };
  }
  if (lower.endsWith('.ps1')) throw Error('Refusing to run ' + found + ' through PowerShell; install a Node or native executable for ' + command);
  if (!/\.(exe|com)$/i.test(lower)) {
    throw Error('Refusing to run non-executable ' + found + ' for ' + command + '; install a Node or native executable');
  }
  return { file: found, args: [...args] };
}

// Explicit partial-Windows check policy: Apple Swift/Xcode/iOS/Watch native
// checks require macOS and are deferred there, never silently skipped.
export function nativeCheckPolicy(platform = process.platform) {
  if (platform === 'win32') {
    return { runnable: false, name: 'npm run test:native',
      reason: 'Apple Swift/Xcode/iOS/Watch native checks require macOS and are deferred to a macOS review; not run on Windows' };
  }
  return { runnable: true };
}

function taskkill() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const candidate = join(root, 'System32', 'taskkill.exe');
  return existsSync(candidate) ? candidate : 'taskkill.exe';
}

// Terminate a child and its whole process tree. Windows has no process-group
// signals, so taskkill.exe /T /F is used with a hidden window and no shell.
export function killProcessTree(child) {
  const pid = child?.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      spawnSync(taskkill(), ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    } catch { /* already exited */ }
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
}
