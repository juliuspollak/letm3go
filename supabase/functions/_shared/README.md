# Shared Edge Function code

Secret-reading helpers stay server-only. `activityPrivacy.js` is a pure geometry/projection helper intentionally reused by frontend previews; it reads no environment or credentials. Credential/media transport implementations must not be imported into the application. No push worker or scheduler is deployed.
