import { it, expect, vi } from 'vitest';
vi.mock('./config.js', () => ({ config: { pushEnabled: false } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { requestPermissions: vi.fn(), register: vi.fn() } }));
import { PushNotifications } from '@capacitor/push-notifications';
import { enableNativePush } from './nativeNotifications.js';
it('does not request permission or register until explicitly configured', async () => {
  expect(await enableNativePush({})).toEqual({ enabled: false, reason: 'disabled' });
  expect(PushNotifications.requestPermissions).not.toHaveBeenCalled();
  expect(PushNotifications.register).not.toHaveBeenCalled();
});
