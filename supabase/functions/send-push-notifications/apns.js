// Pure APNs helpers, shared by the Edge Function and its unit tests.
const SCREENS = new Set(['feedback', 'review', 'home']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only known routing fields leave the database, and only in their expected shape.
export function pushRoute(route) {
  const out = {};
  if (route && SCREENS.has(route.screen)) out.screen = route.screen;
  if (UUID.test(route?.id || '')) out.id = route.id;
  if (UUID.test(route?.from || '')) out.from = route.from;
  return out;
}

export function apnsPayload({ title, body, kind, route, badge, notification_id }) {
  return JSON.stringify({
    aps: { alert: { title, body }, sound: 'default', ...(Number.isInteger(badge) && badge >= 0 ? { badge } : {}) },
    kind, notificationId: String(notification_id), ...pushRoute(route),
  });
}

// Apple rejected our provider token (wrong or expired key), not the device. Such a
// delivery is retried: fixing the key later still delivers it within the day.
const PROVIDER_REASONS = ['InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken'];
export const providerRejected = (status, reason) => status === 403 && PROVIDER_REASONS.includes(reason);

export function classifyApns(status, reason) {
  if (status === 200) return 'sent';
  if (providerRejected(status, reason)) return 'retry';
  if ([400, 404, 410].includes(status) && ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(reason)) return 'invalid_token';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
}
