import { spawnSync } from 'node:child_process';
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export function cliEnvironment(directory, inherited) {
  let tokenFromFile;
  let fd;
  try {
    fd = openSync(path.join(directory, '.env.supabase.local'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid()) {
      throw new Error('Supabase token file must be an owned regular file with permissions 0600. Run chmod 600 .env.supabase.local.');
    }
    if (stat.size > 16384) throw new Error('Supabase token file is too large.');
    let values;
    try { values = parseEnv(readFileSync(fd, 'utf8')); }
    catch { throw new Error('Unable to parse Supabase token file. Use SUPABASE_ACCESS_TOKEN=<token>.'); }
    if (Object.keys(values).some(key => key !== 'SUPABASE_ACCESS_TOKEN')) {
      throw new Error('Supabase token file may contain only SUPABASE_ACCESS_TOKEN.');
    }
    tokenFromFile = values.SUPABASE_ACCESS_TOKEN;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // OS/parser messages may contain credential content; never forward them.
      // eslint-disable-next-line preserve-caught-error -- attaching the original error could expose credential content
      if (error.code) throw new Error('Cannot safely read .env.supabase.local. Check ownership, permissions and that it is not a symlink.');
      throw error;
    }
  } finally { if (fd !== undefined) closeSync(fd); }
  const token = inherited.SUPABASE_ACCESS_TOKEN?.trim() || tokenFromFile?.trim();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is missing. Export it or configure .env.supabase.local with permissions 0600. Supabase CLI was not started; Keychain fallback is disabled.');
  if (/\s/.test(token)) throw new Error('SUPABASE_ACCESS_TOKEN must be a single token without whitespace.');
  return { ...inherited, SUPABASE_ACCESS_TOKEN: token, SUPABASE_HOME: path.join(directory, '.supabase-cli'), SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
}

export function runSupabase(args, { directory = root, inherited = process.env, spawn = spawnSync, report = console.error } = {}) {
  try {
    // These commands manage stored credentials instead of using the supplied token.
    if (args.some(arg => ['login', 'logout', '--token', '--debug'].includes(arg) || arg.startsWith('--token=') || arg.startsWith('--debug=') || arg.startsWith('--log-level'))) {
      throw new Error('Credential storage and debug logging are disabled by this wrapper. Supply SUPABASE_ACCESS_TOKEN through the environment or the protected local file.');
    }
    const env = cliEnvironment(directory, inherited);
    let result;
    try { result = spawn(process.execPath, [path.join(directory, 'node_modules/supabase/dist/supabase.js'), ...args], { cwd: directory, stdio: 'inherit', env }); }
    catch { report('Unable to start Supabase CLI. No credential details were logged.'); return 1; }
    if (result.error) { report('Unable to start Supabase CLI. No credential details were logged.'); return 1; }
    return result.status ?? 1;
  } catch (error) { report(error.message); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSupabase(process.argv.slice(2));
}
