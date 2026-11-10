# Journey metadata: Supabase is the source of truth

Titles, tags, activity types, grouping (merges, splits, source links), stop corrections
and the enrichment answers saved with them (recognised places, road estimates, distance
summaries) live in Supabase as owner-scoped records (`journey_*` tables,
`20261120000000_journey_metadata_records.sql`). The iPhone records GPS and keeps a
**read-only cache** of that metadata for speed and offline viewing.

| Data | Source of truth |
|---|---|
| Original GPS recordings, photos | Native iPhone storage (privately backed up to Supabase) |
| Journey metadata (above) | Supabase |
| Community segments, social sharing | Supabase |
| Local journey metadata | Read-only cache derived from Supabase |

## Reading

`journeyMetadataStore.js` keeps the cache in the durable per-record store. It is refreshed
by `refreshJourneyMetadata` on start, on returning to the app and at the periodic check
(`AutoCloudSync`): one revision request when nothing changed; otherwise the changes since
the cache's cursor mark the affected cached scopes stale, and the scope on screen is
fetched again (`journey_metadata_snapshot`, bounded by `journeyCache.js`: 200 activities,
16 MB, 30 days). A cached value never competes with Supabase and is never uploaded. An
account that has been emptied empties the cache.

## Writing

Every change, from a title edit to a merge, goes through `commitJourneyChanges`
(`useJourneyGrouping.act`, also used by the native activity details):

1. Offline, or no Supabase client: refused with "Connect to the internet to save journey
   changes." Nothing is stored or queued.
2. The change is built on the affected journeys' current copy in Supabase and sent to
   `journey_apply_changes` with that revision. If another device saved first, it is read
   again and retried once; a second conflict says so plainly.
3. Only after Supabase confirms does the cache take the change. A refusal is shown as
   "Your change was not saved: …" and nothing changes.

Values the device works out itself (places, road estimates, distance summaries) are sent
as they are, one request per activity. The done marker shares a record with the title and
tags, so it is written like an edit and can never overwrite a newer title from another
device. If a save cannot be made (offline), the answers stay pending and are retried
silently; they are never shown as an error.

## What was removed

The preferences-file mirror (`journeyGrouping`, `journeyMetadataQueue`, `journeyMetadata`),
the migration to the cloud and its conflict states ("Legacy journey records differ from
cloud records…"), the offline edit queue, three-way field merging and the per-device
recovery states. An earlier build's leftovers are discarded once: the stored cache rows are
rebuilt from Supabase and the three preference keys are cleared. Receipts and every other
preference are untouched, as are recordings, photos and local community segments.

Undo history for grouping changes (`metadata.history`) stays on the device that made the
change; it is not metadata the server holds.
