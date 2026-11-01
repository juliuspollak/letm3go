# Watch manual recording excludes phone automatic history

Superseded in part by [manual-recording-exclusion.md](manual-recording-exclusion.md),
which now owns the exclusion rules for both devices. The sync receipts below still apply.

The phone previously checked Watch presence only when the detector emitted
`depart`. An automatic journey already open when a Watch workout began could
continue, resume after a stop, and split into cycling/walking journeys throughout
the workout. Receiving the Watch start did not close the open automatic draft.

The exclusion now runs when Watch state arrives, before processing automatic GPS,
on automatic timer reconciliation, and before probe/continuation/transition entry
paths. The open approach draft closes at its last genuine fix before the manual
start. Departure, continuation and movement buffers clear. Published history is
not retroactively repaired. Sharing still receives location observations through
its existing consent-controlled path.

A current, same-owner Watch recording or paused manual session owns automatic
history. The 150-second live-icon freshness window remains unchanged; losing
fresh heartbeats does not license the phone to create another automatic activity.
Automatic ownership has a separate twelve-hour lease since the last Watch update,
renewed by the existing heartbeat. Explicit completion releases it immediately.
This bounds abandoned sessions while covering ordinary offline workouts. A workout
started entirely offline, whose start has never reached the phone, cannot be known
by the phone; no cross-device implementation can guarantee exclusion before it
receives that state.

Recording state transitions also use queued user-info delivery, while periodic
heartbeats continue through context/messages. A start announced before WCSession
activation is sent when activation completes. Reconnection repeats terminal state
as well as active state, without changing the recorded end time.

Terminal packets retain the session's start and end, including older peers' idle
packets where the phone already heard their start. Delayed GPS within that interval
is excluded after completion, and older start packets cannot resurrect ownership.
If an end packet arrives first with its complete interval, an overlapping open
automatic draft also closes. If saving that draft fails, automation stays blocked
and the draft is retained for retry. The following drive can start from fresh fixes
outside the manual interval. No fixes are interpolated and unrelated activities
are not merged or deleted.

## Watch sync receipts

“Waiting for iPhone” means the Watch has not retired its outbox entry, not proof
that the iPhone lacks the activity. File delivery and durable application import
are distinct. Before this change, an application receipt used only queued
`transferUserInfo`, so the Watch could keep waiting after successful phone import.
There were no receipt-specific diagnostic events proving the final acknowledgement.

The existing phone inbox now persists a bounded receipt ledger atomically with
import outcomes. Saved/duplicate/rejected/parked receipts contain only an activity
identifier, outcome and timestamp. They travel only between paired devices.

- A reachable Watch receives an immediate message after the import outcome saves.
- Application context retains the latest receipts for activation/reconnection.
- Queued user-info acknowledgements remain for compatibility with older Watches.
- The Watch validates outcomes and processes repeated receipts idempotently.
- It retires a payload only through the existing durable acknowledgement rules.
  File-transfer completion alone never marks it imported or clears its payload.
- A phone inbox save failure prevents acknowledgement; the Watch retains the ride
  and a subsequent retry is safely imported or answered as a duplicate.

This does not establish the cause of any particular missing acknowledgement.
A phone diagnostic export can show successful import without showing whether the
Watch received or saved the receipt. Physical-device confirmation remains required.

## Verification

Native regressions cover long/offline ownership, paused sessions, owner boundaries,
expiry, terminal intervals, reordered packets, approach-draft closure, durable
receipt restoration, validation, deduplication and receipt bounds. Existing outbox
fault-injection tests cover failed index writes and interrupted payload cleanup.

A private, read-only timeline replay can additionally use:

```sh
.build/recorder-tests --watch-exclusion-replay /private/path/timeline.json
```

The JSON shape is `{manualStart, manualEnd, automaticJourneys:[{startedAt}],
expectedExcludedStarts}`. It contains timestamps but no routes or health values;
keep it outside Git. This checks production ownership policy against recorded
event times; it is not a replay of Core Location or WatchConnectivity delivery.

On a paired physical Watch and iPhone:

1. Begin an automatic approach drive, park safely, then start a manual bicycle
   activity on the Watch. Verify `Automatic recording excluded by Watch ownership`.
   The approach drive should end before the Watch recording, without later
   automatic cycling/walking records.
2. Lock the phone and continue the workout through stops and movement changes.
   Temporarily disconnect for longer than 150 seconds. Automatic history remains
   excluded; location-sharing consent and its separate publisher remain intact.
3. Finish the workout and reconnect. Verify `Imported an Apple Watch activity`,
   `Watch import acknowledgement saved`, then the transferred Watch event
   `Watch import acknowledgement received` and `Watch imported payload retired`.
   The Watch should show `On iPhone`. If `Watch payload retirement failed; retained
   for retry` appears, retain the payload and retry; the phone will answer duplicate.
4. Restart either app during pending delivery and repeat reconnection. There must
   be one imported Watch record, with its original route and readings, and a
   safely retired Watch outbox entry. Never delete pending payloads to clear UI.
5. Begin a separate drive after the manual end. Confirm automatic history resumes
   and `Automatic recording released after Watch ownership ended` appears.

Install matching updated phone and Watch builds before acceptance testing. No
migration, backend deployment or historical cleanup is part of this change.
Private diagnostic findings and exact timeline results stay in the local ignored
report rather than this public repository.

Validation for this change: 1,604 native assertions pass. The optional private
historical timeline replay excludes the overlapping automatic starts and adds
one replay assertion; it does not alter existing recordings. ESLint and production
build pass. The web/database run passed 866 tests; one database setup timed out,
and its six tests passed when retried alone (872 total). iOS and direct Watch
simulator builds pass. Physical pairing, background delivery and receipt recovery
still require the real-device procedure above.
