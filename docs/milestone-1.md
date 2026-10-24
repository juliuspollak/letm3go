# Milestone 1 — application and journey experience

Implemented 24 October 2026. No remote migrations, deployments, paid resources or release uploads.

## Working locally

- Responsive Home, Trips, Explore and Map tabs; profile sheet; mobile safe areas; light/dark preference.
- Home activity totals, photo cards, local bookmarks and explicit demo labels.
- Search by title, region, date and tags; activity filtering; useful no-results state.
- Interactive Leaflet maps with pan/zoom, route polylines, start/finish markers and circular clickable photo markers. Map and photo viewer use the same journey metadata.
- Journey details, previous/next photo navigation, local title/story/activity editing with storage failure feedback.
- Dialog Escape, focus containment/restoration and background scroll lock.
- Supabase email sign-in/sign-up, verification messaging, recovery email, recovery password form, persistent session restoration and sign-out. Apple continues to use the existing feature gate.
- Activity chooser opens explicitly simulated previews; it does not request permissions or record location.

Entry points: `src/App.jsx`, `src/styles.css`, `src/components/JourneyMap.jsx`, `src/data/journeys.js`. Tests cover offline auth gates, search, persisted editing, simulated activity selection and photo navigation; existing configuration and native auth tests remain.

## Map decision

Use Leaflet for this web/Capacitor milestone: one interactive map implementation, no required commercial token, DOM photo markers and route polylines. CARTO basemap tiles credit OpenStreetMap/CARTO. This is not a final native recording map decision: assess MapKit with the native GPS slice for battery, marker density, device performance and offline requirements. Do not interpret a browser map as background tracking capability.

## Data and privacy boundaries

Routes are illustrative coordinates, statistics are fixed examples, and Unsplash photographs are illustrative rather than evidence of a real journey. Explore is curated demo content, not a public feed. Demo journeys and bookmarks are stored under separate localStorage keys, never inserted into an authenticated account. Changing demo activity classification does not recalculate fixed example statistics.

External tiles, photographs and Google Fonts require network access; no offline tile or photo caching is implemented. Tile requests disclose the viewed map area to the tile service. Dense photo clustering, inferred photo locations, map-photo highlighting and swipe gestures remain future work.

Auth code uses the configured Supabase client, but live sign-up, email delivery and recovery were not exercised with a real account. Hosted redirect allowlists/email configuration must be verified. Browser recovery uses the current origin; native email recovery deep-link wiring needs device verification before release. No cloud profile editor, account deletion or native onboarding permissions flow is claimed.

## Next vertical slice

Owner-scoped trip persistence, route batches, collections and offline synchronization with executable RLS checks; present migrations for approval before applying remotely. Then native Core Location recording with durable samples and device tests. Household, social, R2 upload and Tesla features are intentionally outside this milestone.

## Verification

- ESLint: passed.
- Vitest: 4 files, 10 tests passed.
- Vite production build: passed; main bundle currently exceeds the 500 kB advisory threshold (about 182 kB gzip). Route/map code splitting remains an optimization.
- Capacitor iOS sync: passed.
- Unsigned Xcode iOS simulator build: passed. Xcode needed normal compiler/package-cache access outside the workspace sandbox.
- Not yet verified: visual simulator walkthrough, physical-device behavior, real-account email delivery/recovery, offline map loading.
