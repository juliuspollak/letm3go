# My Collection redesign

Design proposal for the existing iPhone app. The Collection stays the entry point for vehicles and equipment, using the existing items and trip details. A connected Tesla is a vehicle in the collection with account status and provider facts, independent of automatic recording.

## Collection overview

Use the same sheet background in light and dark mode, one clear **Add item** action and compact list rows divided by category. Each row shows a photo or existing category icon, the display name, useful subtype facts and a chevron. Hide the Archived section until there are archived items. Keep Tesla account management as a dedicated row. Avoid duplicating it inside each Tesla card.

```text
My Collection                              + Add item
Vehicles
  Weekend car             Kia · Sportage             ›
  Blue Tesla              Tesla · Model Y · Electric ›
Equipment
  Trail bike              Mountain bike              ›
Connections
  Tesla                   Connected · 1 vehicle      ›
```

Use the same navigation and clear focus state as the rest of the app. Use one filled primary action at a time. Text and icon together convey connection status so it is readable without color. Use at least 44-point tap targets and let the subtitle wrap with large Dynamic Type.

## Vehicle detail

Open a read-only vehicle overview first. Put editable personal details behind **Edit personal details**. A Tesla's manufacturer, model and powertrain are displayed as provider facts, with explicit unknown states for any unavailable facts. Vehicle actions stay in the existing flow for Trips, archive and removal.

```text
‹ My Collection
Blue Tesla
Tesla Model Y · Electric
Nickname, photo and notes                Edit personal details

View trips                               ›
Tesla account             Connected      Manage
Automatic recording       Unavailable
  Use iPhone recording for trips with this car.

Archive vehicle
```

Do not show setup, pairing or recording switches while the feature is unavailable. Offer **Refresh vehicle details** in Manage Tesla if needed, including for already imported vehicles. Keep it user-initiated and use the existing discovery operation. Account connection, vehicle presence and automatic recording have independent statuses.

## Metadata contract

| Field | Source and display |
|---|---|
| Manufacturer | Set **Tesla** automatically for verified Tesla vehicle imports. |
| Powertrain | Set **Electric** for recognized Tesla road vehicles. Unknown product types remain unclassified. |
| Model | Use a trusted model field returned by the approved vehicle information available to this account. An approved, validated VIN decoder may fill the model when it gives a confident result. The name the owner chose for the car is a nickname and supplies no model evidence. Where the existing discovery response and a validated local decoder cannot supply a result, show **Model unavailable** and keep an optional refresh path. Do not add live read calls or a third-party VIN lookup as a side effect of opening the page. [Tesla vehicle endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints) |
| Nickname, photo, notes, archive state | User-owned. Preserve on refresh and reconcile stable provider IDs with existing Collection IDs. |
| VIN, granular location permission | Server-side only for identity and authorization. No need to display or store them in the app's Collection payload. |

Map known facts into the existing Collection representation where possible, including the existing powertrain field. The current hosted vehicle table stores make/model and has no powertrain column. Compute Electric at the service/client boundary for verified imports and persist it using existing item preferences as appropriate. A schema change, if needed for provider provenance across devices, requires separate approval. Make the refresh merge provider fields explicitly and retain existing names, photos, notes, archive settings and related activity references. A failed or partial refresh preserves previously verified facts and exposes retry status. The disconnected view retains saved facts and vehicle history, with a clear connection state.

## Implementation slices and acceptance

1. Build the Collection overview and read-only vehicle detail with existing local data. Cover mixed vehicles and equipment, empty and archive states, dark mode, large text, and screen-reader order. Manual items retain their existing editing workflow.
2. Add a provider-fact adapter and explicit refresh merge. Test existing and new connected vehicles, verified model data, unknown model, custom names, repeated import and reconnect, no VIN in the response, and preservation of user edits.
3. Use approved staging fixtures for metadata before validating one live Tesla account. Confirm an existing vehicle keeps its ID and linked Trips. Verify the current stack never shows a recording toggle or claims vehicle telemetry works.

This document is a design handoff. It does not change production, permissions, billing or data.
