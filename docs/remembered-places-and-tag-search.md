# Remembered places and tag search

A tag describes one activity; a saved place is what lets a *future* trip recognise where it ended. The tags section is the only place the person states the second, so the two paths must not depend on each other.

## Why a drive to a saved Bunnings was not named Bunnings

| Defect | Where | Effect |
|---|---|---|
| Remembering was a silent no-op | `JourneyTags.jsx` submit handler: `if(!tag||custom.some(t=>t.toLowerCase()===tag.toLowerCase()))return;` ran before the `savePlace` call | Ticking "Remember the destination" for a name the activity already carried returned early, so no place was saved and nothing was said. The most likely reason the trip to Bunnings never created a place |
| A saved place could never be the destination | `journeyRecognition.js` `savedSupported` required 70 % of the *accurate* fixes inside the saved radius, 3 fixes and 5 minutes | A shop has a 200 m radius and a drive crosses it once, so a drive could not reach 70 %: the place could exist and still never become `recognition.primary`, so it never became a tag, title or destination visit |
| A saved place with a provider category was not the destination | `journeyRecognition.js` `role` was `significant?'destination':'visited'`, and a `parking` category became `startFinish` | A saved place that carries a category the natural-place list does not hold (a café, a shop) was only `visited`: no `primary`, no title, no tag. A saved place that ended the trip and reads like parking was demoted to a start/finish |

## The rule now

- `rememberPlace` delegates to `rememberDestinationPlace` (`src/lib/rememberedPlace.js`): it saves the end point of the activity as a `favourite` place with a 200 m radius, independent of any tag, and refuses with a message instead of doing nothing. A place already covering the end is reused, and a place with a foreign id (an Apple Maps identifier) is never overwritten.
- `savedEnd` recognises a saved place where the activity ended: the last recorded fix is inside the saved radius and at least two of the last three are. It uses every recorded fix (`raw`), not only the accurate ones, because the person's own statement about a location does not depend on fix quality. The route-coverage rule stays for the cases it was written for.
- Home and Work are excluded from `savedEnd`: they are personal places, not destinations, and a drive home must not be titled as one.
- A saved place where the activity ended is the destination, and outranks every inferred place: the person named this location, so a park the same drive passed stays `nearby`. A name that reads like parking ("Bunnings car park") is not demoted to a start/finish for the same reason.
- Two overlapping saved places are resolved by distance from the last fixes (`savedEndMetres`), with the name breaking an exact tie, so the result never depends on the order places were saved in.
- The end-of-trip rule feeds the rest of the pipeline unchanged: `assessRoutePlaces` promotes the place to `primary`, `visited` adds the name to the journey's tags, and `destinationVisits` counts the visit.

## Tag search

The picker types into the tags already in the journal. `src/lib/tagSearch.js` owns the rules and `TagSearch` (`ios/App/App/TagSearchCore.swift`) mirrors them:

| Rule | Behaviour |
|---|---|
| One name, however typed | Capitals and runs of spaces are normalised and compared case-insensitively, so "  bunnings " is the tag "Bunnings", not a second one |
| Existing spelling wins | A submit reuses the spelling already in use rather than adding a near duplicate |
| Nothing is fetched | The history arrives with the projection (`tags.known`), so typing costs no network or journal read |
| Prefixes first, then shortest | "Cof" offers "Coffee" before "Coffee stop on the way home", at most six, and never a tag the activity already carries |

A submit is two decisions, not one. If the typed name is already on the trip the tag is not added again, but ticking "Remember the destination" still saves the place — the case that used to do nothing at all.

## Shared wording

`src/lib/tagMessaging.js` owns the sentences (`tagNote`, `rememberLabel`, `tagAdded`, `placeSaved`) and the projection passes them to SwiftUI, so the React section and the native screen cannot drift. `PLACE_SAVED_TEMPLATE` carries `{name}` and `{radius}` because only the screen knows the name the person just typed.

## Tests

- `src/lib/tagSearch.test.js` and `tests/fixtures/tag-search.json` pin the search contract; `tests/native-details/main.swift` replays every fixture case through `TagSearch`.
- `src/lib/rememberedPlace.test.js` covers saving, reuse, foreign ids and each refusal.
- `src/lib/journeyRecognition.test.js` covers the end-of-trip rule, the Home/Work exclusion, overlapping places, a parking-like name, outranking an inferred park, and the resulting tag.
- `tests/fixtures/activity-presentation.json` carries `remembered`, `note`, `rememberLabel`, `addedNote`, `savedNote` and `known` for the native decoder.

## Still unproven

Whether the reported Bunnings trip had a saved place at all. Recognition cannot name a place that was never saved, and the silent no-op above is the most likely reason it was not. The fix makes both halves observable: the save now fails loudly, and the section states which saved place covers the destination.
