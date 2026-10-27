# Build 45 — Smart Collections, trip equipment and equipment search

This build turns **My Collection** from an isolated inventory into a working part of
the journey: category-aware equipment, one-tap assignment on a trip card, a read-only
Tesla identity that can never be guessed, and a Trips filter that finds the drives,
rides and kite sessions that used a specific item.

Nothing about recording, GPS, distance, tracking segments or archive/pin behaviour
changed. Equipment is *additional metadata* on the existing activity record.

## 1. What was already there (and reused)

| Concept | Existing implementation | Decision |
| --- | --- | --- |
| "Collections" | `Garage.jsx` editing `preferences.vehicles` (device-encrypted, offline-first), one detail form per vehicle | **Extended**, not replaced. Same array, same source of truth, same Tesla import path; the detail form becomes the category-aware editor. |
| Vehicle ↔ trip link | `RecordedActivity.vehicle` (label) + `vehicleID`, resolved **by name** in `updateActivity`, consumed by `HouseholdTrips` and source reconciliation | **Extended** to an ordered `equipment` list and resolved **by id first**. `vehicle`/`vehicleID` are still written as the primary entry so Household sharing and `reconcileSources` keep working unchanged. |
| Tesla vehicle identity | Server `public.vehicles` + `fleet_segments`; local imported items carry `teslaVehicleID`; the fleet feed returns `provider_vehicle_id` | Reused as the **only** identity for Tesla trips. No new table, no duplicated vehicle record, no "last used" guessing. |
| Trip search and filters | Client-side predicate over `visibleJourneys` + `searchIndex` + activity/day/favourites filters | **Extended** in place with an equipment predicate and an equipment field in `matchReason`. |
| `activities.collection` | Free-text "Holiday / collection" label per trip | **Untouched.** It is unrelated to My Collection and stays a text label. |

## 2. Data model

### 2.1 Collection item (device-local, in `preferences.vehicles`)

```jsonc
{
  "id": "uuid",                 // stable identity used by every trip reference
  "name": "Geely",              // optional nickname
  "make": "Geely",              // Brand   ─┐ kept as the existing core fields so
  "model": "X3",                // Model   ─┘ Tesla import + Household garage still work
  "category": "car",            // slug from the catalogue below
  "attributes": {               // category-specific, flat string map
    "powertrain": "Electric",
    "year": "2021",
    "registration": "ABC123"
  },
  "photo": "data:image/jpeg;base64,…", // optional, ≤180 KB, 256 px square
  "archived": false,
  "source": "manual",           // or "tesla"
  "teslaVehicleID": "…"         // only for imported vehicles
}
```

A flat `attributes` map was chosen over nullable columns:

* the SQL schema does not grow with each equipment type;
* the native preference file needs one new optional key, not one per category;
* a new category is a client-only addition (the native validator accepts any
  short lowercase slug, so adding a category needs no App Store release);
* old items without `attributes` decode and display unchanged.

The native `LocalVehicle` in `AccountSecurity.swift` now declares `attributes` and
`photo` (otherwise `JSONEncoder` would silently drop them on every preference save)
and validates both: ≤24 attributes, keys `^[a-z][a-z0-9_]{0,31}$`, values ≤120 chars,
JPEG photos ≤180 KB. This also fixes a latent bug: `ebike` was rejected by the old
hard-coded category whitelist (`car`, `motorcycle`, `bicycle`, `other`).

### 2.2 Trip assignment (native record + cloud backup)

```jsonc
// RecordedActivity (encrypted, per account, device)
"equipment": [
  {"id": "collection-item-uuid", "name": "Duotone 12"},  // primary first
  {"id": "collection-item-uuid", "name": "Twin tip"}
]
```

* `vehicle` and `vehicleID` mirror the first entry. Household trip sharing, the
  reconcile-by-vehicle identity and older builds therefore keep seeing a single
  vehicle while the list stays open to kite + board.
* Only the id and a fallback label are stored. Names are re-resolved from the
  Collection at render time, so renaming an item updates every trip. The stored
  label is a last resort for a device that has not restored the Collection yet.
* `assignEquipment(_:)` in `RecorderCore.swift` de-duplicates by id, caps the list at
  8, and clears everything (including `vehicle`/`vehicleID`) when the list is empty.

### 2.3 Cloud backup

`supabase/migrations/20261031000000_collection_equipment.sql`:

```sql
alter table public.activities add column equipment jsonb not null default '[]'::jsonb;
-- shape validation (array ≤8, every entry {id: string 1..100, name?: string ≤100})
create function public.valid_equipment(jsonb) returns boolean immutable …
alter table public.activities add constraint activities_equipment_shape check(public.valid_equipment(equipment));
create or replace function public.backup_private_activity(…) -- same contract + equipment
```

* `backup_private_activity` keeps its owner check, fingerprint idempotency and
  revision conflict rules, and now persists `equipment` on insert and update.
* `cloudRestore.js` restores `equipment` and the primary `vehicleID`, so an explicit
  restore on a new device keeps every assignment.
* Tesla rows remain server-managed: the `protect_fleet_source` trigger still rejects
  any client change, including `equipment`. Their vehicle is derived from
  `provider_vehicle_id`, never stored twice.
* RLS is unchanged: `activities_owner` already limits every read and write to the
  authenticated owner. Collection items never leave the device, so household
  membership cannot widen access to them.

**Deployment note:** the migration is proposed only. Until it is applied, native
assignment still works (it is device-local); cloud backup of a trip that carries
equipment fails with the existing "approved backend RPC" message rather than
silently dropping data.

## 3. Category catalogue

`src/lib/collection.js` is the single source of truth.

| Category | Specific fields |
| --- | --- |
| Car | Powertrain (Petrol, Diesel, Hybrid, PHEV, Electric), Year, Registration, Colour |
| Motorcycle | Type, Year, Registration, Colour |
| Bicycle | Type (Road, Mountain, Gravel, Hybrid, eBike, Other), Year, Colour |
| E-bike | Type (City, Cargo, Mountain, Road, Folding, Other), Year, Colour |
| Kite | Size (m²), Type |
| Kiteboard | Type, Length (cm) |
| Surfboard | Type, Length (ft) |
| Skis / Snowboard | Type, Length (cm), Year |
| Boat | Type, Length (m), Registration |
| Camper | Type, Year, Registration |
| Other | — |

Activity → category mapping (the picker only ever shows these):

| Activity | Categories |
| --- | --- |
| Driving | car, motorcycle |
| Cycling / Road cycling / MTB | bicycle, ebike |
| Kitesurfing | kite, board, surfboard |
| Unknown (auto-detected, unclassified) | car, motorcycle, bicycle, ebike |
| Walking / Running / Hiking / Other | none — the control stays invisible |

`buildCollectionItem` is the only writer: it trims, coerces numbers (accepts `12,5`),
upper-cases registrations, drops choice values the category does not offer, and caps
names at 60 characters. `changeItemCategory` keeps only values the new category can
still interpret and reports exactly what it would drop.

## 4. UI

### 4.1 Adding or editing an item

`CollectionItemEditor.jsx` renders **Category first** as a 12-tile grid. Fields appear
immediately when a category is chosen and change immediately when it changes. Brand is
a searchable `datalist` (any brand can be typed), numbers show their unit, optional
choices are pill buttons that toggle off, and a 256 px square photo is optional.
Editing uses the same component. Changing the category of an existing item with
incompatible values shows one inline confirmation ("Changing to Bicycle removes Size,
Type." — Keep / Change category) instead of a modal.

The list row shows the category icon (or photo), the nickname, `Brand Model · detail ·
source` and an archived marker. Opening an item keeps the form, then adds the number of
activities that used it and a **View N activities** action that opens Trips with the
equipment filter already applied. No Trips interface is duplicated inside Collections.

### 4.2 Assigning equipment to a recorded trip

* **Trip row** — one compact chip at the trailing edge, beside the distance:
  `Geely` when assigned, a discreet dashed `+ Add car` / `+ Add bike` when the
  activity could use something the person owns, and nothing at all when it could not
  (a walk, or a driving trip with no cars in the Collection, keeps the chevron).
  The chip is a sibling of the open button, so opening the trip and changing the
  equipment never conflict. Swipe-to-pin and swipe-to-archive are untouched.
* **Trip detail** — the same chip sits on the activity/datetime line, so the title,
  pencil and privacy actions keep their layout on narrow phones.
* **Sheet** (`EquipmentSheet.jsx`) — compatible items only, photo or category icon,
  name, detail and a check mark on the current item. Tap = assign and close
  (one tap, immediate update through the recorder snapshot). Kitesurfing keeps the
  sheet open so a kite and a board can be tapped together; tapping again removes one.
  "Remove from this activity" clears the assignment. "Add to Collection" opens the
  item editor inline and returns to the list **without** assigning anything, keeping
  the choice explicit.
* **Tesla trips** — the vehicle comes from `provider_vehicle_id`, matched to the
  imported item's `teslaVehicleID`. It renders as a read-only chip. If that car has
  not been imported, no control is shown; importing it in My Collection makes the chip
  appear. A Tesla trip can never be reassigned by hand.
* **Grouped journeys** — the union of their segments' equipment, read-only.


### 4.3 Finding trips by equipment

Inside the existing filter panel (no new navigation, no second search system):

* **Equipment** select (`Any equipment` plus every item that has been used, with a
  count), which composes with activity type, date/day, favourites and archived.
* An active-filter chip under the toolbar (`Using Geely ✕`) that clears it in one tap.
* Free-text search now matches item names, so typing "Duotone" finds the sessions;
  the row explains `Matched equipment: Duotone 12`.
* Counts come from the journeys already in memory, so a Collection item and the
  Trips filter can never disagree.

## 5. Privacy and permissions

* Collection items stay in the per-account encrypted preference file. They are not
  uploaded, so no other account — including household members and friends — can read
  or modify them.
* Trip assignments are written through the native recorder, which already refuses to
  act when the account changed or the UI is locked.
* Cloud backup goes through `backup_private_activity`, which verifies
  `p_owner = auth.uid()`, the active account, and the expected revision. A client
  cannot write a `recording_mode='tesla'` row at all.
* Household vehicle sharing still requires an explicitly linked car and opt-in; it
  publishes only the title, distance and vehicle name, exactly as before.

## 6. Testing

| Area | Coverage |
| --- | --- |
| Catalogue, building, category change | `src/lib/collection.test.js` (15) |
| Category-first editor, bicycle/car/kite fields, edit + confirmation | `src/components/CollectionItemEditor.test.jsx` (4) |
| Assignment sheet, remove, multi-select, add-to-Collection, failure | `src/components/EquipmentSheet.test.jsx` (6) |
| Chip visibility, Tesla/grouped read-only, detail control | `src/components/EquipmentChip.test.jsx` (6) |
| Collection list/detail, View trips, archive/remove | `src/components/Garage.test.jsx` (14) |
| One-tap assignment, equipment filter, archived, Collection → Trips | `src/App.test.jsx` (16) |
| Equipment by id in the activity editor | `src/components/ActivityEditor.test.jsx` (3) |
| Gear preselection at record start | `src/components/RecorderPanel.test.jsx` (10) |
| Native model, dedupe, 8-item cap, clear, legacy decode | `tests/native/main.swift` |
| Column shape, owner isolation, backup round-trip, Tesla protection | `tests/database/collection.test.js` (4) |

Results: `npm run lint` clean, `npm test` green, `npm run test:database` 40 tests,
`npm run test:native` 373 assertions, `npm run build` OK, `npm run ios:build`
BUILD SUCCEEDED.

> Build 46 fixed the persistence gaps this build did not cover: Collection items,
> their photos and trip equipment references are now backed up and restorable on a
> new device. See `docs/persistence-audit-build-46.md` (which also raised the
> database suite to 48 tests).

## 7. Deliberate limits

* Equipment is **not** stored on the trip's distance, route or segments — assignment
  never touches recording, GPS, telemetry or merging rules.
* Grouped journeys are read-only because their id (`journey:<id>`) is virtual; assign
  equipment to the individual recordings and the grouped chip follows.
* A cloud restore on a brand-new device restores trips and their assignments, but the
  Collection itself is device-local; items still have to be re-imported (Tesla) or
  re-added. Assignments keep their fallback label until then.
* The migration must be applied before cloud backup accepts a trip that carries
  equipment. Native assignment, trip cards, detail and filters work without it.

