# DECISIONS

These are the assumptions and judgment calls I made while building the app on my own. Newest decisions are at the bottom of each section.

## Stack and project
- **Vite 6 + React 19 + TypeScript 5.8 + Vitest 3.** These are well-known, stable major versions. Even newer majors exist on npm, but I pinned to versions I could validate.
- **No UI or CSS library.** Styling is one hand-written `styles.css` using CSS variables and logical properties for RTL.
- **App name:** "כוחות" ("Kochot", the Hebrew slang for picking teams). The package name is `kochot`.
- **`base: './'`** in `vite.config.ts`, so the same build works at a domain root (Netlify/Vercel) and at a sub-path (GitHub Pages).

## Balancing engine
- **Cost compares per-player averages, not raw sums.** This makes odd splits (6 vs 5) comparable. It is mathematically the same as giving the short team one "average" phantom player. With equal sizes it is identical to comparing sums. The bigger team gets no extra compensation for having more players.
- **Teams are compared on the mean absolute deviation from the group average** (summed over teams), not max−min. For 2 teams this is exactly the gap between them. For 3+ teams it is smoother for local search.
- **Balance cost is in "rating points":** Σ weight × deviation / Σ weights. Penalties use the same unit.
- **Goalkeeping counts the team's best keeper, not the sum.** Only one player stands in goal. Declared goalkeepers ("can play GK") take priority when picking that best keeper.
- **Goalkeeper and leader rules use one formula:** penalize every team that lacks one, beyond what is unavoidable. With enough keepers, every team gets one. With fewer keepers than teams, keepers are not stacked on one team.
- **Penalty values** (rating points): missing GK = 2, missing leader = 1, each violated keep-together/apart pair = 10, size deviation = 50 per player. All of these dominate any realistic balance gap (typically 0.05–0.6), so the penalties act as near-hard constraints but still give a best-effort answer when they cannot be met. Penalty values are not editable in the UI, to keep settings simple.
- **"Leader" means leadership ≥ 7 by default.** The threshold can be changed in settings.
- **Exhaustive search covers 2 teams with ≤ 14 players.** With equal sizes, player 0 is fixed to team 0, so 14 players means C(13,6) = 1716 splits, which takes a few ms. Everything else uses local search: alternating noisy snake-draft and random starts, then first-improvement swap hill-climbing. It stops after 250 ms or 2000 restarts, whichever comes first.
- **Swaps only, no single-player moves**, so team sizes always equal the target sizes.
- **Pool for re-rolls:** every evaluated neighbor is offered to a bounded pool of the 40 best distinct partitions. Partitions are deduplicated by canonical relabeling.
- **Re-roll picks from near-optimal candidates:** pool entries within `max(0.15, 40% of best)` of the best. If that gives fewer than 3, it widens to the top 3, but never beyond +0.5. That cap is below every penalty, so a re-roll never breaks a GK/leader/constraint rule. Splits already shown are excluded until all candidates have been seen.
- **"Generate" always returns the best split.** "Re-roll" is how you get variety. Re-roll samples from the cached pool (instant) and keeps a history so you don't keep seeing the same teams.
- **Score shown to users:** `100 · exp(−0.5 · cost)`. A typical well-balanced split scores 80–95. A missing goalkeeper drops it into the 30s, and a broken constraint drops it to nearly 0.
- **Out-of-range ratings** (missing or NaN) are clamped to 1–10, with 5 as the default.

## Data and state
- **One localStorage key, `kochot:v1`, holds the whole app state.** Every load goes through `sanitize()`, which clamps ratings, drops dangling ids, and discards an invalid result. Corrupt storage therefore resets parts of the state instead of crashing the app.
- **The last generated result is persisted**, so refreshing the page at the pitch keeps the teams. If attendance or the team count changes afterwards, the teams screen shows a "changed since the split" banner with a one-tap re-split. It does not silently recompute.
- **Ratings edited after a split show up live** in the score and totals, because results store player ids, not copies. The re-roll pool's costs are from generation time; a fresh "split" refreshes them.
- **New players (quick or full add) are marked as present automatically**, since the main use is adding someone at the pitch. You can untick them with one tap.
- **Duplicate names are rejected** (after trimming). Names are capped at 24 characters.
- **"Load sample squad" merges** with your own players. It replaces only earlier sample players (ids `sample-*`) and ticks 10 of the 14 so the demo is a 5v5.
- **A pair can't be both "together" and "apart".** Adding one removes the other. Deleting a player removes their constraints.

## UI
- **Four bottom tabs:** שחקנים (players) / המשחק (game) / קבוצות (teams) / הגדרות (settings). Tabs sync with `location.hash`, so the phone's back button works.
- **Teams are named by bib colour** (אדומים, כחולים, ירוקים, צהובים: red, blue, green, yellow), which is how teams are called at the pitch. That caps the app at **4 teams**.
- **The minimum is 2 players per team.** The Generate button stays disabled with a message until there are enough players.
- **Manual changes are swaps only.** Moving a single player would break the target sizes. "Undo swaps" restores the generated split.
- **Quick add uses tap-to-rate (1–10 buttons) for overall skill.** The full form uses sliders for all 8 attributes.
- **Constraints live in Settings.** The game screen shows a count and a link to them.
- **Weights range from 0 to 5 in 0.5 steps.** 0 means the attribute is ignored.
- **The leader icon is ©** (the captain-armband convention). Goalkeepers get 🧤.
- **The attribute table shows totals (sums)**, as requested, plus a gap column. For goalkeeping it shows each team's best keeper, matching what the engine optimizes, with a footnote. The team header shows the weighted per-player average, which is what the engine actually compares.
- **Share:** the "שיתוף" (share) button uses `navigator.share` when available and otherwise opens `wa.me`. There is also an explicit WhatsApp link and a copy button. Each line starts with a Right-to-Left Mark, so Latin names or numbers don't flip the line order in WhatsApp.
- **System fonts only, no web fonts.** This keeps the app fast and working offline after the first load, and Hebrew system fonts are good on iOS and Android.
- **The re-roll button is outlined; share is solid green.** In dark mode the two filled greens looked identical.

## Tooling
- **Playwright runs with an explicit `executablePath`** because the container provides a pre-installed Chromium build. Override it with `CHROMIUM_PATH`.
- **A GitHub Pages workflow is included.** It runs on pushes to `main` only, so it does nothing on feature branches.
