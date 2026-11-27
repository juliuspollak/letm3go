// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (file) => readFileSync(new URL(`../ios/App/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('Kitesurfing workout diagnostics', () => {
  it('uses the normal workout background mode in every build', () => {
    expect(source('Letm3goWatch/Info.plist')).not.toContain('physical-therapy');
    const project = source('App.xcodeproj/project.pbxproj');
    expect(project).not.toMatch(/KITE_DIAGNOSTIC|Info-KiteDiagnostic/);
    expect(source('Letm3goWatch/KiteDiagnosticRecorder.swift')).not.toMatch(/WKExtendedRuntimeSession|CLLocationManager\(/);
  });

  it('connects the normal workout lifecycle and GPS to capture', () => {
    const recorder = source('Letm3goWatch/WatchRecorder.swift');
    expect(recorder.match(/if ride\.activity == "Kitesurfing" \{ kiteDiagnostic\.begin\(rideID: ride\.id, ownerID: ride\.ownerID\) \}/g)).toHaveLength(2);
    expect(recorder).toContain('kiteDiagnostic.pause(rideID: ride.id)');
    expect(recorder).toContain('kiteDiagnostic.ingestGPS(samples, rideID: ride.id)');
    expect(recorder).toContain('kiteDiagnostic.finish(rideID: ride.id)');
    expect(recorder).toContain('kiteDiagnostic.finish(rideID: draft.id, discard: true)');
  });

  it('accepts and acknowledges diagnostic transfers in Release', () => {
    const phone = source('App/WatchSessionManager.swift');
    const watch = source('Letm3goWatch/WatchConnectivitySession.swift');
    expect(phone).not.toContain('KITE_DIAGNOSTIC');
    expect(watch).not.toContain('KITE_DIAGNOSTIC');
    expect(phone).toContain('KiteDiagnosticInbox.shared.receive(file); return');
    expect(watch).toContain('KiteDiagnosticRecorder.shared.phoneConfirmed(id: id)');
    expect(source('App/KiteDiagnosticInbox.swift')).toContain('directory(for: owner)');
    expect(source('App/KiteDiagnosticInbox.swift')).toContain('recorder.uiUnlocked');
  });
});
