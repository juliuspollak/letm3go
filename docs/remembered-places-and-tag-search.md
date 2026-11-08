# Remembered places and tag search

A tag describes one activity; a saved place is what lets a *future* trip recognise where it ended. The tags section is the only place the person states the second, so the two paths must not depend on each other.

## Why a drive to a saved Bunnings was not named Bunnings

| Defect | Where | Effect |
|---|---|---|
| Remembering was a silent no-op | `JourneyTags.jsx` submit handler: `if(!tag||custom.some(t=>t.toLowerCase()===tag.toLowerCase()))return;` ran before the `savePlace` call | Ticking "Remember the destination" for a name the activity already carried returned early, so no place was saved and nothing was said. The most likely reason the trip to Bunnings never created a place |
| A saved place could never be the destination | `journeyRecognition.js` `savedSupported` required 70 % of the *accurate* fixes inside the saved radius, 3 fixes and 5 minutes | A shop has a 200 m radius and a drive crosses it once, so a drive could not reach 70 %: the place could exist and still never become `recognition.primary`, so it never became a tag, title or destination visit |
| A saved place with a provider category was not the destination | `journeyRecognition.js` `role` was `significant?'destination':'visited'`, and a `parking` category became `startFinish` | A saved place that carries a category the natural-place list does not hold (a café, a shop) was only `visited`: no `primary`, no title, no tag. A saved place that ended the trip and reads like parking was demoted to a start/finish |

## The rule now

- `tagAndRemember` — the one operation the tags section sends, from React (`JourneyTags.jsx`) and from SwiftUI (`activityDetailsRequests.tagAndRemember`) — delegates to `commitTagAndPlace` (`src/lib/tagCommit.js`): it saves the end point of the activity as a `favourite` place with a 200 m radius, independent of any tag, and refuses with a message instead of doing nothing. A place of the same name already covering the end is reused, and a place with a foreign id (an Apple Maps identifier) is never overwritten.
- `savedEnd` recognises a saved place where the activity ended, from how the activity *arrived* at its end, not from every fix the journey ever recorded inside the fence:
  - only the final unbroken run of fixes inside the fence counts. A drive that passes the place, leaves and comes back starts counting again on its return, so fixes from passing earlier never add up to an arrival;
  - a fix less accurate than `USABLE_ACCURACY` (40 m) is neither inside nor outside — iOS often returns a drifting fix once a car has stopped;
  - a usable fix ends the run only when it is outside the fence by more than its own stated accuracy; a fix at the fence edge, which could be either, neither breaks nor extends it, so parking at the edge of a place is not "leaving";
  - the run must hold at least two fixes, because one can be a spike. A drive records every 5 m and the smallest fence has a 50 m radius, so a real arrival leaves several, and stopping in the place then losing GPS keeps the run already recorded;
  - a trip recorded only with poor fixes is judged on the fixes it has, by the same rule. The route-coverage rule stays for the cases it was written for.
- Home and Work are excluded from `savedEnd` (`PERSONAL_PLACE_KINDS`): they are personal places, not destinations, and a drive home must not be titled as one. A place saved beside Home is still a destination.
- A saved place where the activity ended is the destination, and outranks every inferred place: the person named this location, so a park the same drive passed stays `nearby`. A name that reads like parking ("Bunnings car park") is not demoted to a start/finish for the same reason. The tier is only reached by ending there, so a fence a trip merely crossed cannot overtake an inferred score.
- One trip names one saved destination (`singleSavedEnd`). When two fences overlap, the winner is chosen by distance from the same final fix alone (route, dwell and category evidence never decide it), with name and then ID breaking an exact tie; every other one is kept as `nearby` with `evidence.supersededBy` naming the winner. The result never depends on the order places were saved in.
- The journey's end-point tag follows recognition: a non-personal saved place covering the last point is only tagged if it is the place recognition says the trip ended at, so an overlapping fence or a single final fix cannot add a second remembered name. Home/Work end-point tags and the "A → B" location line are unchanged.
- The end-of-trip rule feeds the rest of the pipeline unchanged: `assessRoutePlaces` promotes the place to `primary`, `visited` adds the name to the journey's tags, and `destinationVisits` counts the visit.

## Two writes, one press

Saving a place and adding a tag are independent writes with different lifetimes, and either can fail on its own. `commitTagAndPlace` is the only coordinator, so React and the native screen behave identically:

- the place is saved first, because it never edits the activity; a tag the activity already carries is never written twice;
- neither half is rolled back: a rollback would delete work that succeeded;
- a partial failure names the half still outstanding ("Saved Bunnings as a place. … The tag was not added. Try again to add it."), keeps the typed name and the Remember tick, and a second press finishes it without creating a duplicate;
- a failed place save uses the recorder's own reason (`lastError`) instead of guessing one;
- nothing is reported as done that did not happen, and the only press that does nothing is a tag already on the trip with the toggle off — which the button names rather than offering.

## Tag search

The picker types into the tags already in the journal. `src/lib/tagSearch.js` owns the rules and `TagSearch` (`ios/App/App/TagSearchCore.swift`) mirrors them:

| Rule | Behaviour |
|---|---|
| One name, however typed | Capitals and runs of spaces are normalised and compared case-insensitively, so "  bunnings " is the tag "Bunnings", not a second one |
| Existing spelling wins | A submit reuses the spelling already in use rather than adding a near duplicate |
| Nothing is fetched | The history arrives with the projection (`tags.known`), so typing costs no network or journal read |
| Every tag is offered | The list is not capped: it is built from the journal already in memory, and a cap only ever hides the names a person is least likely to remember typing |
| Prefixes first, then shortest | "Cof" offers "Coffee" before "Coffee stop on the way home", at most six, and never a tag the activity already carries |
| The button names its action | `tagAction` (`src/lib/tagMessaging.js`) and `TagSearch.action` (`TagSearchCore.swift`) answer the same three cases — add, remember, already on this trip — and the wording comes from the projection (`tags.labels`), so neither screen offers a "Remember" press that would not remember |

A submit is two decisions, not one. If the typed name is already on the trip the tag is not added again, but ticking "Remember the destination" still saves the place — the case that used to do nothing at all.

## Shared wording

`src/lib/tagMessaging.js` owns the sentences (`tagNote`, `rememberLabel`, `tagAdded`, `placeSaved`, `alreadyApplied`, `commitNotice`, `TAG_ACTION_LABELS`) and the projection passes them to SwiftUI (`tags.labels`, `tags.appliedNote`), so the React section and the native screen cannot drift. `PLACE_SAVED_TEMPLATE` carries `{name}` and `{radius}` because only the screen knows the name the person just typed.

## Tests

- `src/lib/tagSearch.test.js` and `tests/fixtures/tag-search.json` pin the search contract, the tag limit and the button rule; `tests/native-details/main.swift` replays every fixture case — search and action — through `TagSearch`.
- `src/lib/tagCommit.test.js` covers both halves of a press: success, a tag already there, the limit, each partial failure, an empty name and duplicate prevention.
- `src/lib/rememberedPlace.test.js` covers saving, reuse, foreign ids, Home/Work exclusion, the shared radius and each refusal, including the recorder's own reason.
- `src/lib/journeyRecognition.test.js` covers the end-of-trip rule — drifting fixes (poor, and usable at the fence edge), a recording that stops on arrival or loses GPS afterwards, a drive that only passed, a drive that passes, leaves and comes back with one fix or genuinely stops, one fix inside the fence, all-weak recordings — the Home/Work exclusion, a place saved beside Home, overlapping fences decided by distance whatever their other evidence, deterministic ties and the resulting single tag.
- `src/components/JourneyTags.test.jsx` covers the button wording, both partial failures with a retry, the typed name surviving a failure, and a repeated press while a write is in flight.
- `tests/fixtures/activity-presentation.json` carries `remembered`, `note`, `rememberLabel`, `addedNote`, `savedNote`, `labels`, `appliedNote` and `known` for the native decoder.

## Still unproven

Whether the reported Bunnings trip had a saved place at all. Recognition cannot name a place that was never saved, and the silent no-op above is the most likely reason it was not. The fix makes both halves observable: the save now fails loudly with the recorder's reason, and the section states which saved place covers the destination.

Recognition of a stopped car is tested against synthesised fixes, not a real recording: the 40 m usable threshold and the "final run of fixes inside the fence" rule have not been replayed against a device trace of the reported drive. Nothing here has had structured testing on a physical iPhone.

