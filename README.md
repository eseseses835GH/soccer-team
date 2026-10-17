# כוחות (Kochot): fair teams for pickup football

Nobody wants to be the captain who picks teams. Kochot is a small, mobile-first web app in Hebrew
(RTL). You enter each friend once with a few ratings, tick who showed up tonight, and get balanced
teams in one tap. You can swap players by hand, re-roll for a different fair split, and share the
teams to WhatsApp.

- No signup, no backend. Everything is stored in your browser's `localStorage`.
- Static files only, so it can be hosted anywhere.
- Want to try it in 10 seconds? Tap **"טעינת סגל לדוגמה"** (load sample squad), then go to **המשחק** (game) → **חלוקה לקבוצות** (split into teams).

## Features
- **Players:** quick add (name + tap-to-rate overall skill), or a full form with eight 1–10 sliders
  (overall, stamina, coordination, teamwork, leadership, shooting, dribbling, goalkeeping) plus
  "can play goalkeeper". Edit and delete supported.
- **Tonight's game:** tick attendance, choose 2–4 teams. The format is detected automatically
  (10 → 5 נגד 5, 11 → 6 נגד 5). The app also checks there are enough players.
- **Teams:** colour-named teams (red/blue/green/yellow), a live 0–100 balance score, warnings for
  broken rules, and an attribute comparison table.
- **Tap-to-swap:** tap a player, then a player on another team. The score updates live, and "undo swaps" reverts them.
- **Re-roll:** shows a *different* split that is still near-optimal.
- **Share:** native share sheet / WhatsApp (`wa.me`) / copy to clipboard. The text is RTL-safe.
- **Settings:** attribute weights, leadership threshold, keep-together / keep-apart pairs, sample data, wipe data.
- Dark mode follows the system (`prefers-color-scheme`). Large tap targets, keyboard and screen-reader labels.

## Run it
```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit tests (engine, state, share text)
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ on http://localhost:4173
```
Requires Node 18+ (developed on Node 22).

Visual smoke test, which drives the built app at a 390 px viewport in light and dark mode, saves screenshots,
and fails on console errors or horizontal overflow:
```bash
npm run build && npx vite preview --port 4173 &
npm run screenshots -- ./screenshots
# CHROMIUM_PATH=/path/to/chrome if Playwright's bundled browser isn't at the default path
```

## Project layout
```
src/engine/     pure TypeScript balancing engine (no DOM / React) + tests
src/worker/     Web Worker wrapper around the engine (falls back to inline)
src/state/      model, reducer, localStorage persistence, sample squad
src/ui/         React screens and small components
src/share.ts    WhatsApp text / share / clipboard
src/i18n.ts     Hebrew labels
```

## How the balancing works
Each player is a vector of 8 ratings. For each attribute, the engine compares each team's
**per-player average** with the group average. Comparing averages rather than sums keeps 6-vs-5 splits fair. For
goalkeeping, it compares the *best keeper* of each team, because only one player stands in goal. The deviations are
weighted (default: overall × 3, everything else × 1, configurable) and averaged. The result is the
*balance cost*, measured in rating points.

On top of that, penalties are added:

| Rule | Penalty |
|---|---|
| A team has no "can play GK" player although there are enough keepers for every team (or keepers are stacked when there are too few) | 2 per team |
| A team has no leader (leadership ≥ threshold, default 7) although there are enough leaders | 1 per team |
| A keep-together pair is split, or a keep-apart pair is together | 10 per pair |
| Team size differs from the target sizes | 50 per player |

Penalties are larger than any realistic balance gap, so they act as near-hard rules. When a rule
can't be satisfied, you still get the best possible split.

**Search:**
- **2 teams, ≤ 14 players → exhaustive.** Every split with the right sizes is evaluated. With equal sizes,
  player 0 is pinned to team 0 to skip mirror images (14 players = 1,716 splits, a few ms).
- **Otherwise → local search.** Restarts alternate between a noisy snake draft and a random split.
  Each start is improved by first-improvement hill climbing over pairwise swaps (swaps keep sizes fixed).
  The search runs until 250 ms or 2,000 restarts. 22 players finish in about 0.3 s.
- Every evaluated split is offered to a pool of the 40 best *distinct* partitions. Team labels are
  canonicalized, so "A vs B" and "B vs A" count as one.

**Re-roll** draws at random from pool entries within `max(0.15, 40% of best)` rating points of the best split.
It never goes beyond +0.5, which is below every penalty. It skips splits already shown. The RNG is seedable
(mulberry32), so tests are deterministic.

**Balance score** = `round(100 · e^(−0.5 · cost))`. Well-balanced teams usually land at 80–95, a missing
goalkeeper drops the score to about 35, and a broken constraint drops it to nearly 0.

The search runs in a Web Worker, so the UI never freezes. If workers are unavailable, it runs inline.

## Deploy
`npm run build` produces a fully static `dist/`. The build uses relative asset paths (`base: './'`),
so it works at a domain root or a sub-path.

- **Netlify:** build command `npm run build`, publish directory `dist`. Or drag-and-drop `dist/` onto Netlify Drop.
- **Vercel:** import the repo. The Vite preset is detected (build `npm run build`, output `dist`).
- **GitHub Pages:** the included workflow `.github/workflows/deploy.yml` tests, builds and deploys on
  every push to `main`. Enable it once under *Settings → Pages → Source: GitHub Actions*.
- Any static host or S3 bucket works too: just upload `dist/`.

## Privacy
Player data never leaves the device, except for the text you choose to share.
