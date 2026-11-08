import {normaliseTag} from './tagSearch.js';

// One wording for the two ideas the tags section must never blur: a tag
// describes this activity, a remembered place recognises a destination on future
// visits. React (JourneyTags) and SwiftUI (ActivityTagsSection, through the
// activity presentation) both show these strings.
export const REMEMBER_RADIUS = 200;
// The toggle's name, so a sentence can point at it without repeating the radius.
export const REMEMBER_TOGGLE = 'Remember the destination';

export const tagNote = ({ remembered = null } = {}) => remembered
 ? `Saved place: trips ending within ${remembered.radius} m of ${remembered.name} are named ${remembered.name}.`
 : 'Tags describe this trip only. To recognise this destination on future visits, turn on Remember the destination.';

export const rememberLabel = (radius = REMEMBER_RADIUS) => `Remember this destination on future trips (within ${radius} m)`;

export const tagAdded = 'Tag added to this trip only.';

export const tagLimitReached = limit => `This trip already has ${limit} tags. Remove one before adding another.`;

// The same sentence is shown by React and by SwiftUI, which fills the two names
// into this template from the activity presentation. The destination's name is
// only known where the person typed it, so it stays a placeholder here.
export const PLACE_SAVED_TEMPLATE = 'Saved {name} as a place. Future trips ending within {radius} m are named {name}.';

export const placeSaved = (name, radius = REMEMBER_RADIUS) => PLACE_SAVED_TEMPLATE.split('{name}').join(name).split('{radius}').join(String(radius));

// The button says what a press will do. A tag already on the trip with the toggle
// off has nothing left to do, so it is named instead of offering an action that
// would save nothing: that was the "Remember" button that did not remember.
export const TAG_ACTION_LABELS = { add: 'Add tag', remember: 'Remember', applied: 'Already on this trip' };

export const alreadyApplied = `That tag is already on this trip. Turn on “${REMEMBER_TOGGLE}” to save it as a place.`;

// add: a new tag (and the place when the toggle is on). remember: the tag exists
// or not, the press saves the destination. applied: nothing to do until the toggle
// is on. `TagSearch.action` in Swift answers the same three cases; the fixture
// tests/fixtures/tag-search.json pins them.
export function tagAction({ name = '', applied = false, remembering = false } = {}) {
 if (!normaliseTag(name)) return null;
 if (remembering) return { kind: 'remember', label: TAG_ACTION_LABELS.remember, enabled: true };
 if (applied) return { kind: 'applied', label: TAG_ACTION_LABELS.applied, enabled: false, explanation: alreadyApplied };
 return { kind: 'add', label: TAG_ACTION_LABELS.add, enabled: true };
}

// What a failed place save is called. The recorder's own reason is the sentence
// when there is one; otherwise this is the truthful generic one.
const placeProblem = reason => {
 const text = String(reason || '').trim().replace(/\.$/, '');
 return text ? `${text}.` : 'The destination was not saved.';
};

// One sentence per outcome. Adding a tag and remembering the destination are two
// independent writes, so nothing here reports a whole success when only half
// happened, and every failure says which half is still outstanding.
export function commitNotice({ tag = 'skipped', place = 'skipped', name = '', radius = REMEMBER_RADIUS, reason = '' } = {}) {
 const saved = placeSaved(name, radius), problem = placeProblem(reason), retry = 'Try again to save the destination.';
 if (place === 'saved') return tag === 'failed' ? `${saved} The tag was not added. Try again to add it.` : saved;
 if (place === 'failed') {
  if (tag === 'added') return `${tagAdded} ${problem} ${retry}`;
  if (tag === 'failed') return `${problem} The tag was not added either. ${retry}`;
  return `${problem} ${retry}`;
 }
 if (tag === 'added') return tagAdded;
 if (tag === 'applied') return alreadyApplied;
 return '';
}

