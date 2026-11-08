import { describe, expect, it } from 'vitest';
import { apnsPayload, classifyApns, pushRoute } from './apns.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('APNs payload', () => {
  it('carries the alert, badge and only whitelisted routing fields', () => {
    const payload = JSON.parse(apnsPayload({ title: 'New feedback', body: 'Ann: crash', kind: 'feedback_new', route: { screen: 'feedback', id, extra: 'x' }, badge: 3, notification_id: 7 }));
    expect(payload).toEqual({ aps: { alert: { title: 'New feedback', body: 'Ann: crash' }, sound: 'default', badge: 3 }, kind: 'feedback_new', notificationId: '7', screen: 'feedback', id });
  });
  it('drops unknown screens and malformed ids', () => {
    expect(pushRoute({ screen: 'admin-secret', id: 'not-a-uuid', from: id })).toEqual({ from: id });
  });
  it('classifies Apple responses', () => {
    expect(classifyApns(200, 'Success')).toBe('sent');
    expect(classifyApns(410, 'Unregistered')).toBe('invalid_token');
    expect(classifyApns(400, 'BadDeviceToken')).toBe('invalid_token');
    expect(classifyApns(429, 'TooManyRequests')).toBe('retry');
    expect(classifyApns(503, 'ServiceUnavailable')).toBe('retry');
    expect(classifyApns(400, 'PayloadTooLarge')).toBe('failed');
    expect(classifyApns(403, 'InvalidProviderToken')).toBe('retry');
    expect(classifyApns(403, 'ExpiredProviderToken')).toBe('retry');
    expect(classifyApns(403, 'Forbidden')).toBe('failed');
  });
});
