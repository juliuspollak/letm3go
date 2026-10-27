# Build 44 — motion identity, record control and one avatar resolver

This build adds a small, authored motion system to the web UI that runs inside the
Capacitor WebView, redesigns the bottom-navigation record control, and replaces the
per-screen avatar lookups with one resolver keyed by stable user id.

Nothing here changes recording, trip tracking, maps or Social behaviour: every
animation is decorative, every control keeps its previous action, and the avatar
work is a data-resolution fix rather than a restyle.

## Technology choice

| Option | Decision | Reason |
| --- | --- | --- |
| Motion library (Framer Motion / GSAP / Lottie) | **Not used** | Adds 40–100 KB to the bundle and a runtime for four small animations that are already expressible as GPU-composited transforms. |
| Canvas / WebGL / sprite sheets | **Not used** | Blurry on Retina and wasteful for seven glyphs and a 25 px wordmark. |
| SVG + CSS transitions driven by a tiny React state machine | **Used** | Vector-sharp at any scale, no dependency, compositor-only properties (`transform`, `opacity`, `filter`), and it responds to `prefers-reduced-motion`. |
| Web Animations API | Not needed | The wordmark is a phase sequence, not a keyframe timeline; CSS transitions with per-letter delays are simpler and cancel cleanly. |

Everything is in the existing `src/styles.css` (appended, commented section) plus
four small components. No `package.json` changes.

## 1. The Letm3go wordmark

`src/components/AnimatedWordmark.jsx` renders seven fixed letter slots
(`l e t m 3 g o`) plus the accent arrow. Letters are **never removed from layout**:
phases only hide, fold, scale or draw them. That is what finally removes the
overlapping `m`/`3`/`g` glyphs from earlier attempts — the optical spacing of the
real font is the only spacing that is ever used, and the header cannot reflow.

The sequence (exported as `WORDMARK_SEQUENCE` in `src/lib/wordmark.js`):

| Phase | Hold | Motion |
| --- | --- | --- |
| `intro` | 1.1 s | The seven letters rise 0.36 em with an 84 % scale and a 3 px blur release, staggered 88 ms; the arrow slides in last. |
| `rest` | 3.6 s | Full `letm3go ↗`, static. |
| `bars` | 0.62 s | The digit rotates −18° and fades while three accent bars draw in inside the digit's own slot. |
| `fold` | 0.76 s | `m`, `g`, `o` sink 0.32 em and shrink to 72 %; the three bars slide 0.67 em into the freed `m` slot; the arrow leaves. |
| `compact` | 1.2 s | The mark rests as `let ≡` — still recognisably Letm3go, accent colour intact. |
| `expand` | 0.76 s | The bars return to the digit slot as the digit comes back. |
| `rebuild` | 1.18 s | `m`, `g`, `o` and the arrow return, staggered 70 ms. |
| `rest` | 27 s | Long quiet hold, so the wordmark never becomes distracting. |

Timing is deliberately unhurried (≥0.5 s per gesture) and spring-like via
`cubic-bezier(.22,1.24,.36,1)`; there is no loop beyond this sequence.

**Zero layout shift.** The wordmark's box is the width of the full word at all
times, because invisible letters keep their slots. The header's `space-between`
layout therefore never moves the theme, sharing or profile buttons. On a 393 pt
screen the full wordmark plus arrow is ~120 pt, the three header actions ~120 pt and
the gutters 42 pt, leaving ~110 pt of slack.

**Colour.** The header and rail wrappers colour *every* span accent
(`.brand span`, `.mobile-brand span`). The wordmark now states its colours
explicitly: ink letters, accent digit, accent arrow, accent bars.

**Design review sheet.** `design/motion-preview.html` (served at
`/design/motion-preview.html` by the dev server) renders the real components with
frozen phases, the navigation glyphs mid-animation and every record-control state.
It was reviewed on an iPhone 17 simulator through the actual WebView engine, which

## 2. Record control

`src/components/RecordControl.jsx` is one control used twice: as the raised centre
button of the bottom navigation and as the large launch/stop control in the record
panel. `src/lib/recordingState.js` maps recorder state to appearance so the two can
never disagree:

| Recorder state | Control |
| --- | --- |
| no active recording | idle: accent disc with a soft halo |
| `busy` while starting | starting: dimmed disc with a rotating arc |
| `active.state === 'recording'` | recording: filled accent disc, white rounded-square stop, breathing halo (the panel also gets a ripple) |
| `active.state === 'paused'` | paused: light disc with a darker rounded square |
| `busy` while finishing | saving: dimmed disc with a rotating arc |
| automatic journey in progress | auto: slow breathing outline and a smaller disc — deliberately quieter than a manual recording |

The dot→square morph is a width/height/border-radius transition on one element, so
the symbol changes without swapping icons. Press feedback is a 6 % scale on the
disc. The record destination still only navigates to the Record tab, and the panel
control still calls the same `run('start', …)` / `setConfirm('manual')` handlers,
so recording behaviour is unchanged.

## 3. Navigation glyphs

`src/components/NavGlyph.jsx` draws four destination glyphs and the record glyph on
the same 24-unit grid with the same 1.7 stroke weight as the previous Lucide icons.
`NavButton` owns a tap counter and remounts the drawing group, so each tap replays
the animation *after* the tab has already changed:

* **Home** — the roof lifts and settles with a small overshoot; the door grows up from the threshold.
* **Map** — the folded map unfolds; the location pin drops in with a bounce and the pin dot pops.
* **Trips** — the route draws itself with a dash offset while the marker travels from start to destination.
* **Social** — the second person detaches, settles slightly apart, then reconnects with a spring.
* **Record** — the ring pops and the core pulses (desktop rail only; the bottom bar uses the record control).

Glyphs are `aria-hidden` and never change size or the navigation's layout. There is
no idle animation: motion happens on tap only, which keeps the bar quiet and the
battery untouched.


## 4. One avatar resolver (the Households `J` bug)

### Root cause

The same user was resolved from two different sources:

* the header and the Social presence bubble used `preferences.avatar` (local, always current);
* Household and Friends used `personPhotos[user_id]`, which only exists after
  `usePeopleAvatars` has (a) seen household membership, (b) uploaded the local
  avatar with `save_my_household_avatar`, and (c) read `my_household_member_avatars`.

Each step could fail independently, and the old hook wrapped all of them in one
`try`: a rejected upload (for example a PNG, or an image over the 180 KB database
limit) aborted the whole read and returned `{}`, so **every** avatar in the
household fell back to an initial. The header still showed the photo because it
never touched the RPC. That is exactly the reported inconsistency: the organiser
shows `J` in Households but the correct photo everywhere else.

### Fix

1. `src/lib/avatar.js` — one resolver used by every screen:
   `resolveAvatar({userId, selfId, photos, selfAvatar, name})` returns
   `{src, initial, own}`. The signed-in user is matched by **stable id**
   (case-insensitive), never by display name or household role, and their local
   photo wins because it is always the freshest copy. Initials are only produced
   when no usable image exists.
2. `usePeopleAvatars` always merges the signed-in user into `photos` by id, so the
   header, Friends, Household members and live bubbles cannot disagree — even
   offline or before the RPC answers.
3. The hook no longer aborts the read when an upload fails, and it converts a PNG
   or oversized avatar to a 256 px JPEG (`shareableAvatar`) before publishing it.
4. New migration `supabase/migrations/20261030000000_people_avatar_resolution.sql`:
   * `my_people_avatars()` returns the caller, their household members **and** accepted friends, keyed by `auth.uid()`;
   * `my_household_member_avatars()` keeps working (the client falls back to it on older databases);
   * the avatar check constraint accepts JPEG or PNG up to 180 KB.
5. `PersonAvatar`/`PersonBubble` accept `userId`, `photos`, `selfId` and
   `selfAvatar`, so Household, Friends, presence and the header all render through
   one component. A failed image remembers *that source*, so a newer photo is
   retried instead of being stuck on the initial.

Membership rows and avatar rows both reference `auth.users(id)`, so no additional
profile join is needed: the stable id is the auth user id everywhere.

## 5. Accessibility, battery and backgrounding

* Reduce Motion: `useReducedMotion` renders the wordmark's static `rest` frame and
  the CSS disables every glyph/record animation. Verified in the WebView with
  `reduce:false` and, separately, by unit tests with a stubbed media query.
* Backgrounding: the wordmark clears its timers on `visibilitychange` and resumes
  from the rest frame; no timers run while hidden. Nav and record animations are
  CSS-only and stop being painted when the app is in the background.
* Announcements: the wordmark is one `role="img"` labelled `letm3go`; glyphs are
  `aria-hidden`; the record control keeps a stable `aria-label` plus
  `aria-current`, `aria-busy` and `data-state`, and the navigation publishes a
  screen-reader-only `role="status"` line when recording starts, pauses or is
  handled automatically.
* No new network work, no polling, no rAF loops, no continuous idle animation.

## 6. Validation

| Check | Result |
| --- | --- |
| `npm run lint` | clean (`--max-warnings 0`) |
| `npx vitest run` | 325 tests in 71 files pass (33 new) |
| `npm run test:database` (avatars suite) | visibility rules for self, household, friends, strangers and leavers pass |
| `npm run build` | built successfully |
| `npm run ios:sync` / `npm run ios:build` | Capacitor assets copied, Xcode build succeeded |
| `npm run test:native` | 367 native recorder/auth assertions pass (unchanged) |
| iPhone 17 simulator (WKWebView) | wordmark phases, record states and glyphs rendered and inspected via `design/motion-preview.html` |

## 7. Follow-ups and limitations

* The new SQL function must be deployed for *other people's* photos to appear in
  Friends. Until then the client falls back to the household helper and every
  avatar still resolves for the signed-in user.
* Haptics were deliberately not added: no haptics plugin is installed and the
  request did not require one.
* The motion sheet is a development artefact; it is not part of the production
  bundle because Vite only builds `index.html` by default.
* Visual review was done on an iPhone 17 simulator. A quick pass on a physical
  device (and with Reduce Motion enabled in iOS Settings) is still worthwhile.

is how the glyph-overlap and arrow-visibility issues were found and fixed.
