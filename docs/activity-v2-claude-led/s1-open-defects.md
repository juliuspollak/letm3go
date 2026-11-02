# S1 corrections: review of `src/lib/segmentMatcher.js` (attempt 2 of 2)

The two files are in the working tree, untracked. Read them. Then return BOTH complete corrected files, each in its own fenced block whose first line is `// FILE: <path>` (that line is stripped on extraction: do not also keep a `// FILE:` comment elsewhere). Producing the files is the task. Read-only mode; do not summarise this brief or ask to proceed. Keep the API and style. You cannot run tests, so derive expectations carefully and do not claim a pass.

Vitest ran your files: 13 of 14 pass. `matches an out-and-back traversal once` fails (0 efforts).

## Confirmed defects

**M1 (P1) Finished efforts are discarded when the rider continues.** `walk` keeps going past the finish. In `classify`, `stop === 'reverse'` and `'jump'` are tested BEFORE `reachedFinish`, so riding to the finish then turning back gives a `reverse` reject instead of an effort. Fix: `walk` ends with stop `'finished'` at the first fix whose `along >= lengthMeters`, including that fix for interpolation. A candidate that reached the finish is an effort whatever follows.

**M2 (P1) Continuous laps of a closed loop lose alternate laps.** Because `walk` overruns the finish, it consumes (`used`) the first fixes of the next lap, so that lap never enters near the start. M1's early stop should fix this; add the test below.

**M3 (P1) Out-and-back tie.** `projectOrdered` picks the nearest vertex in its window, so past a turnaround both arms are equally close and the first (lower along) wins, moving progress backwards. Prefer continuation: among vertices in the window whose distance is within a small margin of the best (about 3 m), choose the one that advances along-route progress, never one lower than the current position. This fixes the failing test without widening any tolerance.

**M4 (P1) `samePassRange` allows lap 1 to lap 2.** It only flags `visits >= 3`. When the start and finish locations differ, one return to the start already means another lap. Rule: `limit = metres(points[start], points[finish]) <= tolerance ? 3 : 2`, and `multiple-laps` when `visits >= limit`. A closed loop's single lap (start and finish the same place, pass 1 to pass 2) stays valid.

**M5 (P1) Parallel trails match.** Base tolerance 30 m plus accuracy up to 60 m means a trail 40 m away with a 15 m accuracy is on-route (tolerance 45 m), and the result is merely `low` confidence: a false effort on an adjacent trail. The spec requires close parallel trails be handled and accuracy-informed tolerance. Change `matchToleranceMeters` to 15, `maxWidenMeters` to 25, keep `accuracyWidenFactor` 1, and add `rejectMeanOffsetMeters: 22`: an otherwise complete candidate whose mean offset exceeds it is an `off-route` reject. Keep entry/finish zones at 30 m. Update `lowMeanOffsetMeters` only if required so it stays below the reject value. Your existing low-accuracy test (lateral 8 to 25 m at accuracy 40 m) may need its noise reduced to stay a plausible matched effort: reduce it only if the mean offset passes the new gate, and say so.

**M6 (P2) Dead reject branch.** `classify` reads `effort.meanAccuracy`, which `buildEffort` never sets, so `low-accuracy` can never fire. Return the mean accuracy to `classify` without adding it to the public effort shape required by the brief, or add `meanAccuracyMeters` to the effort if simpler. Add a test exercising the reject.

**M7 (P3)** Remove the `// FILE:` comment lines from the delivered source.

**M8 (P3)** ESLint fails: `segmentStats` is imported but unused in `src/lib/segmentMatcher.test.js`. Remove the import.

## Required new tests, all deterministic
- Ride continues past the finish along the same line, then turns and comes back over the trail: exactly one effort from the outbound pass, and the return is a `reverse` reject.
- Rider approaches along a 100 m extension before the start and exits along a 100 m extension after the finish: elapsed within 1 s of the true crossing-to-crossing time (a stronger test than entering exactly at the line).
- Three continuous laps of the closed loop with no break: exactly three efforts.
- `samePassRange` lap 1 to lap 2 with different start and finish taps: `multiple-laps`. Closed loop pass 1 to pass 2: valid.
- Parallel trail 40 m away with accuracy 15 m: no effort.
- Mean accuracy at or above `rejectAccuracyMeters`: `low-accuracy` reject. Note a track that noisy must stay within tolerance for the branch to be reachable: set up the fixture accordingly, for example near-zero lateral noise with a reported accuracy of 70 m.

Do not delete or weaken any existing test except the low-accuracy noise adjustment above.

## Finish
After the two files, list per defect what changed and anything unresolved.
