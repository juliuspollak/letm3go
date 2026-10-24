import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { config } from './config.js';

// Call only from an explicit user action after signing in. The future backend
// adapter must own registration, logout revocation, and authenticated token storage.
export async function enableNativePush({ persistToken, onError }) {
  if (!config.pushEnabled || !Capacitor.isNativePlatform()) return { enabled: false, reason: 'disabled' };
  if (typeof persistToken !== 'function' || typeof onError !== 'function') throw new Error('Push requires a verified backend adapter.');
  const handles = [];
  const dispose = async () => { await Promise.all(handles.map((handle) => handle.remove())); };
  try {
    handles.push(await PushNotifications.addListener('registration', ({ value }) => {
      // Never log device tokens or send them to an unverified endpoint.
      Promise.resolve().then(() => persistToken({ token: value, environment: config.apnsEnvironment })).catch(onError);
    }));
    handles.push(await PushNotifications.addListener('registrationError', () => onError(new Error('Push registration failed.'))));
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      await dispose();
      return { enabled: false, reason: 'denied' };
    }
    await PushNotifications.register();
    return { enabled: true, dispose };
  } catch (error) { await dispose(); throw error; }
}
