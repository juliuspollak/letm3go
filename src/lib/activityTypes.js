// Every value an activity can hold, in the order the editor lists them. Metadata, grouping, the editor
// and the picker all read this one list (Swift's twin is ActivityTypes.stored), so a type that can be
// recorded can always be classified, renamed and saved again.
export const ACTIVITY_TYPES=['Walking','Running','Cycling','MTB','Road cycling','Gym','Rope skipping','Other','Driving','Kitesurfing','Hiking','Unknown'];
// What a person can choose when changing an activity. Rope skipping is recorded and counted on the Watch,
// so it is kept when an activity already has it (typesWithCurrent) but is not offered as a new choice.
export const CHOOSABLE_ACTIVITY_TYPES=ACTIVITY_TYPES.filter(type=>type!=='Rope skipping');
