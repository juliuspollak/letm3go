// Search-as-you-type for tags the person already uses. There is one tag system:
// the tags on recorded activities and the tags saved in the journey metadata.
// This only reads them; it never writes a tag, a table or a second list.
// The same rules are implemented in TagSearch (ios/App/App/TagSearchCore.swift) for
// the native tags field; tests/fixtures/tag-search.json pins both.
export const TAG_SUGGESTION_LIMIT = 6;
// Most recent first, so the tags a person still uses lead the list.
export const KNOWN_TAG_LIMIT = 200;

export const normaliseTag = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const tagKey = value => normaliseTag(value).toLocaleLowerCase();

// Distinct tags across the activities already built for the journal, newest
// activity first. `journeys` is the projection App already holds, so typing
// never scans GPS history or asks a provider.
export function knownTags(journeys = []) {
 const seen = new Map();
 for (const journey of [...journeys].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))) {
  for (const tag of journey?.tags || []) {
   const name = normaliseTag(tag);
   if (!name || name.length > 50) continue;
   const key = name.toLocaleLowerCase();
   if (!seen.has(key)) seen.set(key, name);
  }
 }
 return [...seen.values()].slice(0, KNOWN_TAG_LIMIT);
}

// The journal projection is rebuilt often; the tag list is derived from one
// array identity, so opening an activity never walks the history again.
const index = new WeakMap();
export function cachedKnownTags(journeys) {
 if (!Array.isArray(journeys)) return [];
 if (!index.has(journeys)) index.set(journeys, knownTags(journeys));
 return index.get(journeys);
}

// Matching suggestions for what has been typed. A tag already applied to this
// activity is never offered again, and a name that differs only by capitalisation
// or spacing is the same tag, not a new one.
export function tagSuggestions({ known = [], applied = [], query = '', limit = TAG_SUGGESTION_LIMIT } = {}) {
 const text = normaliseTag(query);
 if (!text) return [];
 const needle = text.toLocaleLowerCase();
 const appliedKeys = new Set(applied.map(tagKey));
 const unique = new Map();
 for (const name of known) {
  const clean = normaliseTag(name), key = clean.toLocaleLowerCase();
  if (!clean || clean.length > 50 || appliedKeys.has(key) || !key.includes(needle) || unique.has(key)) continue;
  unique.set(key, clean);
 }
 return [...unique.entries()]
  .sort(([aKey, aName], [bKey, bName]) => {
   const aPrefix = aKey.startsWith(needle), bPrefix = bKey.startsWith(needle);
   if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
   return aKey.length - bKey.length || aName.localeCompare(bName);
  })
  .slice(0, Math.max(0, limit))
  .map(([, name]) => name);
}

// The name that a submit would use, whether it is already on this activity, and
// whether it would create a new tag. An existing spelling always wins, so
// "bunnings" reuses "Bunnings" instead of adding a second tag.
export function tagChoice({ known = [], applied = [], query = '' } = {}) {
 const text = normaliseTag(query), key = tagKey(text);
 const onActivity = applied.find(name => tagKey(name) === key);
 const existing = onActivity ?? known.find(name => tagKey(name) === key);
 return { name: existing ? normaliseTag(existing) : text, applied: Boolean(onActivity), create: Boolean(text) && !existing };
}
