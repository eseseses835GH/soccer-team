# STATUS

## What was built
- **The full MVP** described in the brief: a Hebrew, RTL, mobile-first static web app (Vite + React + TypeScript). It has no backend and no signup, and stores data in `localStorage` through a never-throwing wrapper.
- **Players screen:**
  - Quick add: name plus tap-to-rate overall skill.
  - Full form: 8 sliders (default 5) and a "can play goalkeeper" switch.
  - Edit and delete, with confirmation.
  - Duplicate-name check.
  - Empty state with a "load sample squad" button.
- **Game screen:**
  - Attendance ticks, with select-all, clear, and search when there are more than 12 players.
  - Team count stepper (2–4) with an auto-detected format (5 נגד 5, 6 נגד 5, 4 נגד 4 נגד 3…).
  - Validation for the minimum number of players.
  - Shortcut to constraints.
- **Teams screen:**
  - Colour-named team cards and a live 0–100 balance score with a label.
  - Rule-violation warnings.
  - Tap-to-swap with live re-scoring, and undo swaps.
  - Re-roll for a different near-optimal split.
  - Share (native share / wa.me), an explicit WhatsApp link, and copy.
  - An attribute comparison table: sums, best keeper, goalkeeper and leader counts, and the gap between teams.
  - A "stale" banner when attendance changed after the split.
- **Settings screen:**
  - Attribute weights (0–5) and the leadership threshold.
  - Keep-together / keep-apart pairs.
  - Load sample squad, wipe data, and a short "how it works".
- **Balancing engine** (`src/engine`, pure TypeScript):
  - Weighted per-attribute deviation cost, plus goalkeeper, leader, constraint and size penalties.
  - Exhaustive search for 2 teams with ≤ 14 players.
  - Greedy or random restarts with swap hill-climbing otherwise.
  - A deduplicated top-40 pool for re-rolls.
  - Seeded RNG.
  - Runs in a Web Worker, with an inline fallback.
- **Design and accessibility:** light and dark themes via `prefers-color-scheme`, tap targets ≥ 44 px, ARIA labels and roles, visible focus, and `prefers-reduced-motion` support.
- **Docs and deployment:** `README.md` (English), `PLAN.md`, `DECISIONS.md`, and a GitHub Pages deploy workflow.

## What was tested
- **`npm test`:** 26 Vitest tests, all passing.
  - Engine:
    - Team sizes.
    - Even and odd counts are optimal (checked against brute force).
    - Local search reaches the exhaustive optimum.
    - 3 teams match brute force.
    - Uneven 3-team sizes.
    - Keep-together and keep-apart, for both 2 and 3 teams.
    - Violation reporting.
    - Every team gets a goalkeeper when possible, and keepers are not stacked when there are too few.
    - Leader distribution.
    - Determinism with a fixed seed.
    - Re-roll gives a different, near-optimal split.
    - Canonicalization.
  - Performance: 22 players in 2 or 3 teams finishes in about 0.3 s (limit 1 s); 14 players exhaustive takes a few ms.
  - State: sanitizing corrupt storage, reducer cleanup on delete, constraint exclusivity, swap/undo, sample-squad merge.
  - Share text: Hebrew team names and RTL marks on every line, plus the `wa.me` encoding.
- **`npm run build`:** type-check and production build both pass.
- **`npm run screenshots`** (Playwright, 390×844, light and dark): all screens and flows render with no console errors, no horizontal overflow, and `direction: rtl`. I reviewed the screenshots by eye. Two issues found and fixed: re-roll and share looked identical in dark mode, and screenshots were catching the sheet mid-animation.
- **`npm run e2e`:** quick add, duplicate-name rejection, the "not enough players" state, persistence across reload, 22 players into 3 teams (about 350 ms in the browser, sizes 8/7/7), re-roll changes the teams, and a keep-apart pair entered in the UI is respected.

## Known limitations
- **No offline/PWA support:** there is no service worker or manifest, so a reload without signal fails.
- **No export/import or sync:** data lives in a single browser. A friend's phone can't see your roster.
- **Re-roll uses a stale pool after settings changes:** the pool's costs come from when teams were generated. Changing weights or constraints afterwards affects the live score but not the re-roll candidates until you split again.
- **Pool can be thin for small groups:** with very few players (e.g. 4–6), there may be only 1–2 near-optimal splits, so re-roll can alternate between them or say there's no alternative.
- **Large groups aren't guaranteed optimal:** for more than 14 players or 3+ teams, local search is heuristic. Tests show it matches brute force on the sizes we can verify.
- **Swap-only manual edits:** you can't move one player to make 6 vs 5 into 7 vs 4.
- **No end-to-end check of the real share sheet:** native share and clipboard on real iOS and Android weren't tested (the headless browser has no share sheet). The text and URL generation are unit-tested.
- **Hebrew sorting:** names are sorted with `localeCompare('he')`, and mixed Hebrew/Latin rosters sort Latin first.

## 5 most valuable next steps
1. **PWA:** add a manifest and service worker so it installs to the home screen and works with no reception at the pitch.
2. **Share the roster:** export/import via a link or QR code (compressed JSON in the URL hash), so the group shares one rated roster without a backend.
3. **Learn from results:** record match scores and nudge ratings over time (Elo-style), so ratings stop being a matter of opinion.
4. **Smarter re-roll:** re-run the search with a fresh seed and current settings in the worker, and prefer splits that differ more from the previous ones.
5. **Rating help:** add a "how good is 7?" guide and an optional peer-rating mode where several friends rate and the app averages, which makes ratings fairer and less awkward.
