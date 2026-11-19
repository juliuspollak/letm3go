// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The diagnostic must stay out of production: no background mode in the shipping plist, and the
// compile flag only on Debug configurations.
describe('kitesurfing sensor diagnostic isolation', () => {
  const watch = (f) => readFileSync(new URL(`../ios/App/Letm3goWatch/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  it('keeps the physical-therapy background mode out of the shipping Watch plist', () => {
    expect(watch('Info.plist')).not.toContain('physical-therapy');
    expect(watch('Info-KiteDiagnostic.plist')).toContain('physical-therapy');
  });
  it('differs from the shipping plist only by that mode', () => {
    expect(watch('Info-KiteDiagnostic.plist').replace('\t\t<string>physical-therapy</string>\n', '')).toBe(watch('Info.plist'));
  });
  it('enables KITE_DIAGNOSTIC only in Debug build configurations', () => {
    const project = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
    const configs = project.split(/(?=\t\t[0-9A-F]{24} \/\* (?:Debug|Release) \*\/ = \{)/);
    const flagged = configs.filter((c) => c.includes('KITE_DIAGNOSTIC'));
    expect(flagged.length).toBe(2);
    for (const c of flagged) expect(c).toMatch(/name = Debug;/);
  });
  it('wraps every diagnostic source in the compile flag', () => {
    for (const f of ['KiteDiagnosticRecorder.swift', 'KiteDiagnosticView.swift']) expect(watch(f).startsWith('#if KITE_DIAGNOSTIC')).toBe(true);
    expect(readFileSync(new URL('../ios/App/App/KiteDiagnosticInbox.swift', import.meta.url), 'utf8').startsWith('#if KITE_DIAGNOSTIC')).toBe(true);
  });
});
