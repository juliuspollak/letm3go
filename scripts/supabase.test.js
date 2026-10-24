// @vitest-environment node
import { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cliEnvironment, runSupabase } from './supabase.mjs';
import viteConfig from '../vite.config.js';

let directory, spawn, report;
const fakeToken = 'test-only-placeholder';
const tokenFile = () => path.join(directory, '.env.supabase.local');
function file(content, mode = 0o600) { rmSync(tokenFile(), { force: true }); writeFileSync(tokenFile(), content, { mode }); chmodSync(tokenFile(), mode); }
function run(args = ['projects', 'list'], inherited = {}) { return runSupabase(args, { directory, inherited, spawn, report }); }
beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'letm3go-cli-test-')); spawn = vi.fn(() => ({ status: 0 })); report = vi.fn(); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('fails before invoking the CLI when token is missing, empty or whitespace', () => {
  for (const inherited of [{}, { SUPABASE_ACCESS_TOKEN: '' }, { SUPABASE_ACCESS_TOKEN: '  ' }]) expect(run(undefined, inherited)).toBe(1);
  file('SUPABASE_ACCESS_TOKEN=""\n'); expect(run()).toBe(1);
  expect(spawn).not.toHaveBeenCalled(); expect(report.mock.calls.flat().join(' ')).toContain('Keychain fallback is disabled');
});
it('uses the Node environment parser for quoted values, export and comments', () => {
  file(`# server only\nexport SUPABASE_ACCESS_TOKEN="${fakeToken}" # comment\n`);
  expect(run()).toBe(0);
  const [, args, options] = spawn.mock.calls[0];
  expect(options.env.SUPABASE_ACCESS_TOKEN).toBe(fakeToken);
  expect(options.env.SUPABASE_HOME).toBe(path.join(directory, '.supabase-cli'));
  expect(args).not.toContain(fakeToken); expect(report).not.toHaveBeenCalled();
});
it('preserves inherited variables and gives an exported token precedence', () => {
  file(`SUPABASE_ACCESS_TOKEN=${fakeToken}\n`);
  expect(cliEnvironment(directory, { PATH: '/test', SUPABASE_ACCESS_TOKEN: 'exported-placeholder' })).toMatchObject({ PATH: '/test', SUPABASE_ACCESS_TOKEN: 'exported-placeholder' });
});
it('accepts an exported token without a file and never loads .env.local', () => {
  writeFileSync(path.join(directory, '.env.local'), `SUPABASE_ACCESS_TOKEN=${fakeToken}\n`);
  expect(run()).toBe(1); expect(spawn).not.toHaveBeenCalled();
  expect(run(undefined, { SUPABASE_ACCESS_TOKEN: fakeToken })).toBe(0);
});
it('rejects unsafe file modes even when an exported token exists', () => {
  for (const mode of [0o644, 0o666, 0o400, 0o700]) {
    file(`SUPABASE_ACCESS_TOKEN=${fakeToken}`, mode);
    expect(run(undefined, { SUPABASE_ACCESS_TOKEN: fakeToken })).toBe(1);
  }
  expect(spawn).not.toHaveBeenCalled(); expect(report.mock.calls.flat().join(' ')).not.toContain(fakeToken);
});
it('rejects symlinks without reading the target', () => {
  const target = path.join(directory, 'target'); writeFileSync(target, `SUPABASE_ACCESS_TOKEN=${fakeToken}`, { mode: 0o600 }); symlinkSync(target, tokenFile());
  expect(run()).toBe(1); expect(spawn).not.toHaveBeenCalled(); expect(report.mock.calls.flat().join(' ')).not.toContain(fakeToken);
});
it('does not load unrelated or frontend variables from the token file', () => {
  file(`SUPABASE_ACCESS_TOKEN=${fakeToken}\nVITE_SECRET=${fakeToken}`);
  expect(run()).toBe(1); expect(spawn).not.toHaveBeenCalled(); expect(report.mock.calls.flat().join(' ')).not.toContain(fakeToken);
});
it('rejects multiline tokens without exposing their content', () => {
  file(`SUPABASE_ACCESS_TOKEN="${fakeToken}\nsecond-line"`);
  expect(run()).toBe(1); expect(spawn).not.toHaveBeenCalled(); expect(report.mock.calls.flat().join(' ')).not.toContain(fakeToken);
});
it('blocks credential-storage and debug commands without invoking CLI', () => {
  for (const args of [['login'], ['logout'], ['projects', 'list', '--debug'], ['projects', 'list', '--debug=true'], ['--log-level', 'trace'], ['login', '--token=placeholder']]) expect(run(args, { SUPABASE_ACCESS_TOKEN: fakeToken })).toBe(1);
  expect(spawn).not.toHaveBeenCalled();
});
it('does not expose process errors and preserves normal CLI exit status', () => {
  spawn.mockImplementationOnce(() => { throw new Error(fakeToken); });
  expect(run(undefined, { SUPABASE_ACCESS_TOKEN: fakeToken })).toBe(1);
  spawn.mockReturnValueOnce({ error: new Error(fakeToken) });
  expect(run(undefined, { SUPABASE_ACCESS_TOKEN: fakeToken })).toBe(1);
  expect(report.mock.calls.flat().join(' ')).not.toContain(fakeToken);
  spawn.mockReturnValueOnce({ status: 7 }); expect(run(undefined, { SUPABASE_ACCESS_TOKEN: fakeToken })).toBe(7);
});
it('keeps CLI credentials outside Vite and native asset inputs', () => {
  expect(() => viteConfig({ mode: 'supabase' })).toThrow('reserved');
  expect(viteConfig({ mode: 'production' }).envPrefix).toBe('VITE_');
  expect(JSON.parse(readFileSync('capacitor.config.json', 'utf8')).webDir).toBe('dist');
  expect(readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')).not.toContain('.env.supabase.local');
});
