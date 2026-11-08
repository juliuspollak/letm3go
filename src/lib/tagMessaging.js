// One wording for the two ideas the tags section must never blur: a tag
// describes this activity, a remembered place recognises a destination on future
// visits. React (JourneyTags) and SwiftUI (ActivityTagsSection, through the
// activity presentation) both show these strings.
export const REMEMBER_RADIUS = 200;

export const tagNote = ({ remembered = null } = {}) => remembered
 ? `Saved place: trips ending within ${remembered.radius} m of ${remembered.name} are named ${remembered.name}.`
 : 'Tags describe this trip only. To recognise this destination on future visits, turn on Remember the destination.';

export const rememberLabel = (radius = REMEMBER_RADIUS) => `Remember this destination on future trips (within ${radius} m)`;

export const tagAdded = 'Tag added to this trip only.';

// The same sentence is shown by React and by SwiftUI, which fills the two names
// into this template from the activity presentation. The destination's name is
// only known where the person typed it, so it stays a placeholder here.
export const PLACE_SAVED_TEMPLATE = 'Saved {name} as a place. Future trips ending within {radius} m are named {name}.';

export const placeSaved = (name, radius = REMEMBER_RADIUS) => PLACE_SAVED_TEMPLATE.split('{name}').join(name).split('{radius}').join(String(radius));
