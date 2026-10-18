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
- **System fonts only, no web fonts.** This keeps the app fast (there is no service worker, so it is not offline-capable yet), and Hebrew system fonts are good on iOS and Android.
- **The re-roll button is outlined; share is solid green.** In dark mode the two filled greens looked identical.

## Tooling
- **Playwright runs with an explicit `executablePath`** because the container provides a pre-installed Chromium build. Override it with `CHROMIUM_PATH`.
- **A GitHub Pages workflow is included.** It runs on pushes to `main` only, so it does nothing on feature branches.

---

# v2: decisions after the first round of feedback

These came out of the conversation with the user. Points marked *(my call)* were left open and I decided them.

## Format: players per team, winner stays
- **The user picks players per team (3–7 on the main screen), not the number of teams.** `planFormat` fills full teams first.
- **A remainder missing at most 2 players (and of at least 2) becomes a short team that waits outside** and borrows from the losing team. For 5-a-side: 14 → 5·5·4 and 13 → 5·5·3. A smaller remainder becomes substitutes: 11 → 5·5 + 1 sub, 12 → 5·5 + 2 subs. *(my call: the user confirmed "5-a-side with 11 means one sub", and the 13 case was open.)*
- **With fewer than two full teams, everyone is split into two even teams** and the plan says so (8 at 5-a-side → 4 נגד 4).
- **At most 8 teams** (8 bib colours). Extra players beyond that become subs.
- **The short team waits first; the two full teams start.**
- **Who moves over from the losing team is decided at the pitch** (user's decision). The app only says "משלימים N מהמפסידה" (borrow N from the losing team).

## Goalkeepers
- **Default: rotating keepers.** Each team gets a random keeper order (1, 2, 3…) and keepers switch every N goals conceded (1 by default; 2 or 3 in settings). There is no goalkeeper rating any more.
- **"Fixed keeper" mode** brings back the "one declared keeper per team" rule. The "שוער קבוע" (fixed keeper) toggle only appears on the player form in this mode.

## Players and cards
- **Attributes are now: level, stamina, passing, dribbling, shooting, defence, teamwork, leadership.** Defence and passing were added; coordination and goalkeeping were removed. v1 "coordination" is migrated into "passing".
- **Every attribute starts at the player's level, and cards add or subtract on top of it.** In v1 the other attributes defaulted to 5, which made an "8" player average in everything. Changing the level or the cards recomputes the attributes. The sliders ("כיוון עדין", fine-tuning) come after that.
- **Six cards, at most two per player.** The user felt even 8 was a lot, so the list is short and optional. Picking a third card drops the oldest.
- **Sub selection is random**, preferring players without pair rules, and you can swap a sub in by tapping. *(my call: optimizing who sits out would always bench the weakest player, which feels bad.)*

## Late arrivals
- **A late arrival never reshuffles everyone.** They join the smallest team that isn't full (normally the short team outside). If every team is full, they become a sub, and once the subs reach the short-team threshold they become a new team that joins the back of the queue.
- **A swap suggestion appears only when no team is short any more**, i.e. the arrival "completed" the teams (the user's example: 4-a-side, 3 waiting, the 4th arrives). It offers up to 2 swaps, shows the score before and after, and the user accepts or keeps things as they are.
- **Someone arriving late who isn't in the roster** is added with a name and level and stays in the roster (they can be deleted later).

## Match night
- **The timer counts down from the match length** (default 8 minutes, set in settings), then shows overtime in red. It is timestamp-based, so it survives reloads and screen locks. It uses the Wake Lock API when available, and vibrates and beeps at zero.
- **Draws:** you pick who leaves. The default is the team that has been on the pitch longer. On the first match there is no default. *(my call)*
- **With exactly 2 teams nobody leaves;** results are just recorded.
- **Dominance hint:** shown after 3 wins in a row, or ≥ 75% wins after 4+ matches. It offers one swap that makes that team weaker while keeping balance as good as possible. "Not now" hides it for 2 matches.
- **Scorers are optional:** after each goal a sheet asks who scored, with "דילוג" (skip).

## Storage, privacy, sharing
- **Still local-only (localStorage),** with three additions:
  - (1) **A PWA** (manifest and service worker): add to home screen, works offline, and installed web apps aren't subject to Safari's 7-day storage eviction.
  - (2) **A backup link** (`#import=` + deflate + base64url) for a second organizer. Opening it shows an import sheet that merges players by id or name.
  - (3) **A backup file** (JSON) and a CSV/text roster import, with a downloadable template.
- **The link and the file include ratings**, and the UI says so.
- **The teams screen no longer shows individual ratings,** since people look over your shoulder at the pitch. The 0–100 score stays big (the user liked it). The per-team averages table is folded under "פירוט האיזון" (balance details).
- **The WhatsApp text has names, keeper order, borrowers, subs and the overall score;** no ratings.
- **A new game day starts empty:** 12 hours after the last attendance or team activity, attendance and teams reset, and "כמו בפעם הקודמת" (same as last time) restores the previous list. The user said games aren't weekly and attendance varies.

## Design
- **One main screen ("מי הגיע היום?", "who came today?")** with a big black "עושים כוחות" button. Players and settings are icons in the top bar. No bottom tab bar.
- **Less boxy design:** lists with dividers instead of cards, a warm off-white background, black as the main action colour, green only for "present" ticks and good scores, bib colours only on team headers. Font: Heebo (Google Fonts, cached by the service worker).
- **The animation is at the moment of splitting, not on opening the app:** names "deal" into the team columns with a stagger, and the score counts up. Both are disabled under `prefers-reduced-motion`.
- **Toasts appear at the bottom,** so they don't cover the match clock.

---

# v3: changes after setup

## Look
- **Light/dark is a choice in Settings ("מראה"): בהיר (light), כהה (dark) or לפי הטלפון (follow the phone).** The default stays "follow the phone", so nothing changes for existing users. The choice sets `data-theme` on the page root, and the phone's status-bar colour (`theme-color`) follows it.
- **A main ("accent") colour can be picked: green (default), blue, purple, orange, pink.** It colours buttons, attendance ticks and the balance score. Each colour has a darker shade for light mode and a lighter one for dark mode, so text stays readable. Bib colours and the WhatsApp green don't change. *(my call: the user asked for "different colours"; red was left out so it isn't confused with warnings and delete buttons.)*
- **The look is per phone.** Importing another organizer's backup keeps your own theme and colour.
