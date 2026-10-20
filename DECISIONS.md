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

## Cards and sliders (v3)
- **12 cards, balanced: 6 strengths and 6 weaknesses** ("חוזקות" / "חולשות"), shown as two labelled rows of compact chips. The picked cards' one-liners appear under the rows, so the jokes are still there without making the form long.
  - Strengths: 🦍 החיה, 🎯 הצלף, 🪄 הקוסם, 🧠 המוח (new: passing +4, teamwork +2), 🧱 הסלע, 📣 הקפטן.
  - Weaknesses: 🐢 איטי (stamina −2, dribbling −2, defence −1), 😮‍💨 נגמר אחרי 5 דקות (stamina −4, defence −1), 🏖️ לא חוזר להגנה (defence −4, teamwork −1), 🙅 לא מוסר (moved here, unchanged), 🥶 מפחד מהכדור (dribbling, shooting, defence −2 each), 🌱 מתחיל (passing −1, teamwork −2, leadership −2).
- **All six v2 ids and deltas are unchanged**, so stored players keep their cards and ratings; no id was renamed, so nothing needed migrating. `sanitize` now also drops duplicates and opposite pairs and caps the list at the new maximum. *(my call: 🪄 הקוסם stays a strength although its deltas sum to zero; it's a style card, flashy but loses the ball.)*
- **Cards never change the level itself.** A weakness lowers specific ratings relative to the level, so the level still says "how good", and the card says "in what way". 🌱 מתחיל is about not knowing the game yet (positioning, teamwork, leadership), because a low level already covers the skill. It also lowers leadership, so a beginner is rarely counted as a team's leader.
- **Up to 3 cards per player** (was 2). *(my call: with two rows, the natural profile is "two strengths and a weakness" or the reverse; more than 3 makes the emoji row noisy and stacks deltas to the 1/10 clamps.)* Picking a 4th drops the oldest, as before.
- **Opposite cards replace each other:** החיה ↔ נגמר אחרי 5 דקות, המוח ↔ לא מוסר, הסלע ↔ לא חוזר להגנה, הקפטן ↔ מתחיל. This avoids profiles that cancel out to nothing.
- **Weakness emojis are shown only on the players screen and the import preview.** On the home (attendance) and teams screens, `CardBadges` shows strengths only, because people look over the organizer's shoulder there. *(my call)*
- **"What does the level mean":** one hint under the level buttons: "1 = רק התחיל לשחק · 5 = באמצע החבורה · 10 = הכי טוב אצלנו". The level is relative to this group, not to football in general.
- **Sliders are now "דירוג מפורט" (detailed rating)**, in both quick add (folded, one tap to open) and the edit sheet (open by default). Changing the level or a card still recomputes them from scratch; the hint says so, and the summary says "כוונן ידנית" (hand-tuned) when the sliders differ from what level + cards give.
- **Import** recognises all 12 card names in the order written, plus short forms `נגמר`, `לא חוזר`, `מפחד`. Longer names match first, so one phrase is never counted twice. The template now shows a weakness card too.
- **e2e:** the backup-link step now also stubs `navigator.share`, because desktop Chrome on macOS has it and the step hung waiting for the clipboard. This was not caused by the cards work.

## Borrowing from the losing team (v3)
This supersedes the v2 line "Who moves over from the losing team is decided at the pitch". The app now suggests who moves; the pitch still has the last word.
- **The criterion is the user's: "so the next match is as even as possible".** After a match, if a short team is on the pitch, the app tries every choice of borrower(s) from the team that just left and picks the one that makes "short team + borrowers" closest to the team it faces. It uses the engine's balance measure (weighted gap between per-player attribute averages, in rating points) and shows it on the usual 0–100 scale ("מדד המשחק הבא").
- **Only balance and pair rules count for this choice.** A keep-apart pair inside the new line-up, or borrowing one half of a keep-together pair, costs the usual constraint penalty. The goalkeeper and leader rules are about the split, not one match, so they are left out. *(my call: otherwise a "missing leader" penalty would outweigh "as even as possible".)*
- **Ties go to the earliest player in the team's list,** so the same situation always gives the same suggestion. With 2 borrowers (5·5·3) every pair is tried; at most 55 combinations.
- **It's an optional card under the pitch, not a pop-up:** title "משלימים את הצהובים מהכחולים", the reason ("מומלץ: דני עובר לצהובים, כך המשחק הבא הכי שווה"), the losing team's players as chips with the suggestion pre-selected, אישור (confirm) and דילוג (skip). Tapping another player overrides; with 2 to borrow, a third tap drops the oldest pick (like the player cards). On an override it shows both scores ("53 (עם ההמלצה 71)"). *(my call: per-player scores aren't shown on the chips, since people look over your shoulder and it would rank players.)*
- **Borrowers are temporary.** The split (`result.assignment`) never changes. The match state records `borrow: { team, from, ids }` for the current match only; ending the match clears it and copies it into that match's history record. The losing team's other players sit out with their team, which goes to the back of the queue as before.
- **A short team that wins and stays borrows again, from the new loser.** Its previous borrower goes back to his own team (which may be the next team to come on). This is the same step, shown again.
- **Borrowers appear in the "who scored?" list** of the team they play for, so goals are credited to them. They are **not** added to that team's keeper rotation *(my call: the rotation order is per team and stays stable across the evening)*.
- **Skipping is remembered for that match** (empty `ids`), so the card doesn't come back after a reload. After confirming, a one-line "🔁 דני משחק עם הצהובים במשחק הזה" stays, with "שינוי" (change) to reopen the card.
- **Old saved match states load unchanged:** a missing or malformed `borrow` becomes "not decided yet".
- **Nothing changed in how teams are split.** I checked the short team's balance at split time with a simulation (200 random 14-player squads at 5-a-side, both possible losers). With the suggested borrower the next match is about as even as the first 5-v-5 (mean score ~87 vs ~89). A random borrower gives ~80 and the worst one ~71, so the suggestion matters. A split that also looked at "best borrower from each possible loser" would raise the worst-case match by only ~2–3 points, and it would change the core search, so it is left as a proposal (see STATUS).
- **Small style fix:** a selected chip (`.member.chip.sel`) is now filled like a selected member. Before, the selected sub chip on the teams screen showed light text on a light background.

## Goal celebration
- **Tapping "+ גול" plays a ~2 s burst:** a big "גוֹל!" in the scoring team's bib colour (outlined in the text colour, so yellow/white/black bibs stay readable in both themes), a ring, 28 confetti pieces in the bib colour, a lighter tint and gold, and a ⚽ that shoots up from the goal buttons. It sits above the scorer sheet but is `pointer-events: none`, so the sheet and the clock stay usable while it plays. The overlay clips itself, so it can't cause horizontal scrolling. *(my call: placed at 30% from the top, over the clock and score, because the scorer sheet covers the bottom half.)*
- **Reduced motion:** no confetti, ring or ball; the word just fades in and out (via the Web Animations API, because the global reduced-motion CSS rule switches off all CSS animations).
- **Sound is synthesized with Web Audio, no audio files:** a stadium air horn (two blasts), then a crowd roar that swells for ~0.5 s, holds and fades over ~3 s. The roar is pink noise in three bands; the "aaah" is 16 detuned sawtooth "shouters" through vowel formants, each with its own vibrato, loudness wobble, start time and rising pitch. A compressor keeps it from clipping. A short vibration pattern plays too.
- **Announcer:** `speechSynthesis` with a Hebrew voice says "גוֹוֹוֹל! גוֹל ל<team>!" (pitch 1.3). If the phone lists voices but none is Hebrew, the announcer stays quiet (a foreign voice reading Hebrew sounds broken) and only the crowd plays. If no voices are listed yet, it still tries with `lang = he-IL`.
- **iOS:** the AudioContext is created/resumed and the speech is started inside the tap handler. One shared AudioContext is reused. A new goal fades out the previous celebration instead of stacking them.
- **Undo goal doesn't celebrate.** Only the "+ גול" handler triggers it.
- **Setting `goalSound`: קהל וקריין (crowd + announcer, default) / רק קהל (crowd only) / בלי צליל (off).** It's in Settings → משחק. The animation always plays. Like the theme, it's per phone: importing a backup keeps your own choice.
- **Quick mute on the match screen:** a speaker icon at the top corner. It toggles between off and crowd + announcer (so unmuting from "crowd only" goes back to both). Muting also cuts a celebration that's playing.

## Evening summary and history (v3)
- **One record per match session, keyed by a stable id.** `EveningRecord` (`src/state/history.ts`) is plain JSON: id, dates, team size, a names snapshot of everyone there, each team's bib id and final roster, the bench, and every match (score, goals with optional scorer, who played on each side, clock time). It never points into live state, so it still reads right after players are renamed or deleted, bibs change, or on another phone.
- **The id comes from the split** (`ev-<createdAt>-<hash of the players>`). Ending the evening twice with the same teams (end, start again, end) merges into one evening instead of creating two. Two copies of the same id always merge (matches unioned by end time), so a future sync can merge by id without duplicates. *(my call)*
- **When an evening is saved:** on "סיום הערב"; on the 12-hour new-day reset (inside `sanitize()`, before the match is cleared); and whenever a session with finished matches is dropped some other way (a fresh split, deleting a player who was playing, loading the sample). Nothing is lost silently. A session with no finished match is not saved. Wiping all data wipes the history too.
- **The match on the pitch counts when the evening ends** if it has a goal or ran at least a minute; otherwise it is ignored. *(my call: people often forget to press "end match" for the last game.)*
- **Who played in each match is stamped when the match ends** (in the reducer, which knows the rosters), so per-player wins stay right after swaps, dominance swaps and late arrivals. Borrowed players aren't recorded by the app, so a borrower's win counts only for their own team.
- **The summary only shows stats that mean something:** the evening's winner only if one team is strictly ahead (wins, then goal difference, then goals); top scorer only if scorers were recorded; "most wins" only if at most 4 players share it and it's at least 2; streak from 2 wins; biggest win from a 2-goal margin; "most open match" from 3 goals and only if it isn't also the biggest win; minutes only if every match has a time. Ties list up to three names.
- **The stat numbers count up once and the highlights rise in**, both off under `prefers-reduced-motion`. Sharing is a quiet secondary button (native share sheet, otherwise copy), with names only.
- **History is capped at 150 evenings** (newest kept), roughly 300–500 KB at most in localStorage.
- **Backup:** the backup *file* includes the history and importing a file merges it by id. The backup *link* leaves it out so it stays short enough for WhatsApp.
- **All-time view** has three short leaderboards: goals, win percentage (from 5 matches) and evenings attended (hidden when everyone came every time). Players are matched by id, then by current name, then by the name in the record, because ids differ between phones. Ties share a place.
- **Navigation:** a clock icon ("ערבים קודמים") on the main screen's top bar (only once there is a history) opens `#history`; each evening is `#evening/<id>`. After "סיום הערב" the app opens that evening's summary; back goes to the list, then home.
- **Deleting an evening** is local only (no tombstone), so a later merge from someone else's copy could bring it back. Fine for now; the sync work should decide.
- **Merge note (manager):** a player borrowed from the losing team counts on the side he played for in per-player wins (the borrow card and the history were built in parallel and joined at merge time).

## Groups, login and sync (v3)

### Groups on the phone
- **Every group ("כדורגל בשכונה", "בבסיס", "במשרד") has its own full app state** under `kochot:group:<id>`, plus an index `kochot:groups` (names, which one is open, which are in the cloud). Group ids are v4 UUIDs made with `crypto.getRandomValues`, because `crypto.randomUUID` is missing on plain-http LAN addresses (the phone at `http://172.20.10.2:5173`).
- **Upgrade without data loss:** on first run the old `kochot:v1` blob is copied *as is* (not re-sanitized) into the first group, named "הקבוצה שלי". The old key is removed only after both new keys were written; if writing fails, the old key stays and the migration runs again next time. `sanitize()` is still the gate on every load and every pull.
- **The group switcher is the group name under "כוחות" in the top bar** (with a ▾ and, for cloud groups, a status dot). It opens one sheet: the list, "קבוצה חדשה", and for the open group: sync/invite, rename, delete/leave. *(my call: no new screen or tab; the top bar already had room.)*
- **The last group on the phone can't be deleted** (the button is disabled with a hint); "מחיקת כל הנתונים" in Settings now empties only the open group.
- **The look (theme, accent) stays per phone:** it is carried over when switching groups and when joining one, and it is never uploaded.
- **Settings other than the look are per group** (keepers, match length, bibs, weights, pairs), since they belong to how that group plays.

### Login
- **Optional.** Nothing changes for someone who never logs in: the Supabase library isn't even downloaded (it is a separate lazy chunk). It is loaded only when a session is stored on the phone, a login link returns (`?code=`), an invite link is opened, or the user taps "התחברות". The e2e test checks that a logged-out session makes no requests to Supabase.
- **Methods: Google, a one-time code by email, email + password.** No SMS. The code form also accepts the magic link in the same email. The Google button checks `/auth/v1/settings` and, while Google isn't enabled in the project, shows "Google עוד לא הופעל בפרויקט…" instead of sending the user to an error page.
- **PKCE flow, redirect = `location.origin + location.pathname`**, so the same build works on localhost, the LAN IP and a static host. The `?code=` is removed from the address bar after login.
- **Logging out keeps everything on the phone.** Cloud groups just stop syncing (status "לא מחוברים") until you log in again. *(my call: the app is used at the pitch, and wiping on logout would be a surprise; a shared phone is unlikely.)*

### Server (Supabase)
- **Tables:** `groups (id, name, data jsonb, version, created_by/at, updated_by/at)`, `group_members (group_id, user_id, role, joined_at)`, `group_invites (token, group_id, role, created_by, created_at, expires_at, revoked_at)`. SQL is in `supabase/migrations/`.
- **RLS on every table.** Members can read their groups, their groups' members and invites, and update a group's `name` and `data` (column-level grant). Nobody can insert or delete rows directly; that goes through RPCs. `anon` has no access at all. Membership is checked by `private.is_group_member()` (security definer, in a schema the API doesn't expose, so policies don't recurse).
- **RPCs:** `create_group(id, name, data)` (the caller becomes organizer), `create_invite(group_id)` (members only), `join_group(token)`, `leave_group(group_id)` (the last organizer leaving deletes the group). The privileged bodies live in `private`; `public` has thin security-invoker wrappers, so the security advisor has no findings.
- **Invites:** a random 24-byte token (base64url, 32 characters), valid for 14 days, reusable by several organizers within that time. Unknown, expired and revoked tokens give the same error. Revoking exists in the schema (`revoked_at`), not in the UI yet.
- **Roles:** only `organizer` exists (sees and edits everything, ratings included). `role` is a column with a check constraint; a read-only "player" role needs a migration that widens the check and adds policies/views without ratings.
- **A version number per group, bumped by a trigger on every update.** The trigger also pins `id`, `created_by`, `created_at` and sets `updated_by`.
- **Size cap:** `data` must be under 1 MB.
- **Realtime** is on for `groups` (RLS applies to what each phone receives).

### What is synced, and how
- **Synced:** players, pair rules, group settings (without theme/accent; see `LOCAL_SETTINGS` in `src/sync/doc.ts`), the group name, and `history` (evening records with an `id`) when the app has one. **Not synced:** tonight's attendance, players per team, the split, the running match, and "same as last time". Two organizers at the same pitch each tick attendance on their own phone. *(my call: live state changes every few seconds and conflicts are meaningless there; the roster is what people re-type.)*
- **Local-first:** every edit is saved on the phone immediately, as before. Sync runs on open, on focus, when back online, on a realtime update from another phone (plus a 60 s poll while visible), and 1.5 s after a local edit to synced data.
- **Three-way merge against the last agreed copy (`base`, kept in `kochot:sync:<id>`):** players and history records by id, pair rules as a set, settings per field. A change on one side wins; if both sides changed the same player, this phone wins; an edit beats a delete; anything added on either side is kept. So a new player can't be lost, even when two phones were offline at the same time.
- **The push is conditional** (`update … where version = n`). If another phone got in first, the round pulls again and re-merges (up to 3 times). There is no separate offline queue: "local copy differs from `base`" *is* the queue, and it survives app restarts.
- **Edits made while a round is in flight win** over what the round brings back (a second three-way merge when applying).
- **Duplicate names:** if two organizers add "יוסי" at the same time, both are kept (different ids). *(my call: merging by name could merge two different people.)*
- **A synced "מחיקת כל הנתונים" deletes for everyone**, and Settings says so above the button.
- **"Leave group" needs a connection;** joining while offline remembers the invite and retries when the phone is back online.
- **The service worker never touches Supabase requests** (explicit bypass for `*.supabase.co` and `/auth|rest|realtime/v1/`).

### Config
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are in `.env`, which is committed. The publishable key is meant for browsers; RLS is what protects the data. No secret or service-role key is used anywhere in the client. Without these variables the app hides login and sync entirely.
- **`@supabase/supabase-js` is pinned to 2.112.4** (released August 2026), not the newest.
- **Merge notes (manager):** the goal-sound choice stays per phone like the look (added to `LOCAL_SETTINGS`). Synced evening history goes through the history module's own `sanitizeHistory` / `mergeHistory`, so records from another phone are validated, sorted newest first and capped the same way as local ones.

## Swipe to delete (v4)
- **Direction follows the page, like iOS and WhatsApp in Hebrew.** The delete action sits on the trailing edge, which is the left in RTL. So you drag a row to the right and a red "מחיקה" appears on the left. Dragging the other way does nothing. In an LTR page it would be mirrored, because `SwipeRow` reads `direction` from the row.
- **Deleting always asks first** with a small sheet: "למחוק את דני?", a line that past evenings in the history stay as they were, and notes only when they apply: he is in today's teams (the teams are cancelled; games already played are saved to the history), he has together/apart pairs (they go too), or the group is synced (he is removed for the other organizers too). Buttons: "מחיקה" (red) and "ביטול". Tapping "מחיקה" on the row asks, and so does a full swipe (past 60% of the row width).
- **The edit sheet's "מחיקה" opens the same sheet** instead of the old in-place "בטוח? מחיקה סופית" button. This is the way to delete without swiping, for keyboard, screen reader and desktop users. The revealed button is labelled "מחיקת <name>". It is hidden from the tab order and screen readers while the row is closed.
- **Scrolling wins.** Rows have `touch-action: pan-y`, so the browser keeps vertical scrolling. A swipe starts only after 10 px of mostly horizontal movement (|dx| ≥ 1.5·|dy|). A vertical move cancels it for that touch.
- **Only one row is open at a time.** Opening a row closes any other. A tap outside the row, or any scroll, closes it. A tap on another row only closes the open one (it doesn't also open that player), and a tap on an open row's content closes it. A tap on a closed row opens the edit sheet as before.
- **Pointer events,** so a mouse drag works too. Snapping uses a short CSS transition, which the global `prefers-reduced-motion` rule turns off.
- **No undo toast.** Deleting can also cancel today's teams and pairs, and a plain re-insert wouldn't bring those back, so an "undo" would be misleading. The confirmation is the safety net. The toast still says "<name> נמחק".
- `SwipeRow` (`src/ui/SwipeRow.tsx`) is a generic `<li>` wrapper, so other lists can reuse it. The sheet is `src/ui/DeletePlayerSheet.tsx`.

## Whistles and air horn (v4)
*Supersedes the crowd roar, the announcer and the three-way sound setting in "Goal celebration" above; the GoalBurst animation is unchanged.*
- **User feedback:** "a starting whistle, and at the end too; goal without the weird AI voice, an air horn". The user chose **air horn only** for goals. `speechSynthesis` and the crowd roar are gone completely (the bundle no longer mentions speech).
- **All sounds are synthesized with Web Audio in `src/ui/sounds.ts`** (replaces `celebrate.ts`), no audio files:
  - **Air horn (goal):** two blasts, short (0.3 s) then long (1.15 s). Three reeds at ~372/466/557 Hz (a slightly sour chord, like a handheld stadium horn), each two detuned sawtooths plus a square. Pitch scoops up from −14% at each onset and sags 3% at the end; a shared 5 Hz pressure wobble; asymmetric soft saturation, high-pass, a bell resonance at 1.35 kHz and a "blare" peak at 2.9 kHz, low-pass at 5.2 kHz.
  - **Referee pea whistle:** ~3.0–3.15 kHz sine with weak 2nd/3rd harmonics; the "pea" is a ~28 Hz triangle (its rate wandering ±4 Hz) driving ±110 Hz of FM and deep tremolo, plus slow filtered-noise drift; breath noise band-passed at the whistle pitch and a little hiss; 8 ms attack with an upward pitch flick, quick release with a small drop.
  - **Patterns:** kick-off = short-long; full time = short-short-long.
  - **Levels:** each sound goes through a master gain and a gentle limiter. Offline renders peak at about −1.7 dBFS (`npm run render-sounds` fails outside −12…−1 dBFS).
- **When they play:**
  - **Kick-off whistle** on "התחלה" only when the match clock is at 0 (a fresh match, or after the clock was reset). "המשך" after a pause is silent.
  - **Full-time whistle** once per match: when the countdown hits zero (together with the existing vibration, which replaces the old beep), or when "סיום משחק" is tapped if it hasn't sounded yet. A draw sheet that is cancelled and re-opened doesn't whistle again.
  - **Goal:** vibration + horn on "+ גול" (undo stays silent). A new sound fades out the one playing.
- **iOS / autoplay:** the shared AudioContext is created/resumed inside taps (start, resume, goal, end), and the match screen also unlocks it on the first tap anywhere (for a screen opened after a reload). The time-up whistle has no tap of its own, so it plays only if the context is already running; otherwise only the vibration fires and the "סיום משחק" tap blows the whistle instead. *(my call: a suspended context would otherwise hold the whistle and blurt it out on some later tap.)*
- **Setting `goalSound` is now `'on' | 'off'`**, labelled "צלילים: פועל / כבוי" in Settings → משחק, and covers horn + whistles. Old values migrate in `sanitizeSettings`: `'all'`/`'crowd'` → on, `'off'` → off. Still per phone (`LOCAL_SETTINGS`), so importing or syncing never changes it. The speaker icon on the match screen mutes/unmutes all match sounds ("השתקת הצלילים" / "הפעלת הצלילים").

## Hosting (v4)
- **Vercel**, with the user's own domain. Production = the GitHub branch `claude/loving-allen-zp89uf` (the repo's only and default branch) until a `main` exists. The setup guide for the user is `docs/SETUP-HOSTING-AND-LOGIN.md` (Hebrew).
- **`vercel.json`:** Vite preset, `npm run build` → `dist`. `/`, `/index.html`, `/sw.js` and `/manifest.webmanifest` are `Cache-Control: no-cache` (the manifest also gets `application/manifest+json`); `/assets/*` is `max-age=31536000, immutable` (content-hashed names). Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- **No CSP (yet).** It would have to allow Supabase REST/auth (`https://*.supabase.co`) and realtime (`wss://*.supabase.co`), Google Fonts (`fonts.googleapis.com` styles, `fonts.gstatic.com` fonts), the module worker, `data:`/`blob:` uses and React inline `style` attributes, and it can't be verified end-to-end before the domain and Google login exist. A wrong CSP breaks login silently on users' phones. *(my call: add it later, first as `Content-Security-Policy-Report-Only`.)*
- **Service worker versioning:** a small build plugin (`scripts/sw-manifest.mjs`, used by `vite.config.ts`) stamps `dist/sw.js` with `BUILD` (a hash of everything in `dist/`) and `PRECACHE` (entry chunk, its static imports, CSS, the balancing worker; not the lazy Supabase chunk, so logged-out users still never download it). Same content → same hash → no needless update.
  - Install precaches the shell + `PRECACHE` with `cache: 'reload'`; if anything fails, the install fails and the previous version stays (no half-empty cache). Then `skipWaiting` + `clients.claim`; activate deletes every cache except the current one and `kochot-fonts`.
  - Navigations are network-first (only `ok` responses are cached as `index.html`); other un-hashed files (manifest, icons, CSV) are network-first with a cache fallback; `assets/*` and Google Fonts are cache-first. Asset lookups use `ignoreVary`, because precached copies were fetched without an `Origin` header while module scripts/CSS are requested with one (Vite preview sends `Vary: Origin`, which made the offline load fail in testing).
  - An open old tab after a deploy keeps working with what it already loaded; if it then needs a chunk it never loaded (e.g. taps login for the first time), that chunk is gone on Vercel anyway. Closing and reopening fixes it.
- **Env:** the Supabase URL and publishable key come from the committed `.env`; Vercel needs no environment variables, and no secret is ever put there.
- **GitHub Pages workflow** stays as it is (runs only on `main`), superseded by Vercel.

- **Weak connection (manager):** opening the app waits for the network at most 3.5 s, then uses the cached page (the network answer still refreshes the cache), so a weak signal at the pitch doesn't block the app.

## Positions and player profile (v4)
The user's structure for a player (after talking it over with friends): **level → where he's strong → (folded) more about him**.

### The profile
- **Level 1–10 stays the main thing.** Quick add at the pitch is still: name, level, add. Positions are one optional tap row; everything else is folded.
- **"איפה הוא חזק?" (where is he strong): 🧤 שוער, 🛡️ הגנה, 🔄 קישור, ⚡ התקפה, any number of them.** Engine ids: `def`, `mid`, `att` in `Player.positions`. Stored in a fixed order (def, mid, att); unknown values and duplicates are dropped by `sanitizePositions`.
- **🧤 שוער *is* `canGK`.** One control, one field, no duplicate data. The old "שוער קבוע" toggle (only shown in fixed-keeper mode) is gone: the 🧤 chip is always there. It still matters for the split only in fixed-keeper mode (the existing rule: one declared keeper per team). When keepers rotate *(my call, the user said "the keeper usually rotates"; **superseded in v7: the rotation is plain random again**)*: a 🧤 player starts in goal for his team, and everyone else still takes their turn in random order (one keeper first, not all of them, so the rotation still feels like a rotation). A one-line hint under the chips says which of the two applies.
- **"עוד על השחקן" (more about the player), folded by default:** the 12 strength/weakness cards, unchanged, and inside it another fold, **"דירוג מפורט מתקדם"** (advanced detailed rating) with the per-attribute sliders. Level and cards still recompute the sliders. The edit sheet opens "more" when the player has cards or hand-tuned sliders, and the sliders fold when they're hand-tuned; the open state is only the initial one, so removing the last card doesn't snap the fold shut. The summary line shows the picked cards' emojis.
- **No positions = the `positions` field is left out** (not stored as `[]`). Old players and players without positions keep exactly their previous shape, so the synced doc and backups don't change for nothing and a phone still on the previous version sees identical player records. *(my call)* Caveat: a phone still running the previous version that edits a player and pushes would drop that player's positions (its `sanitizePlayer` doesn't know the field). Phones update the PWA on the next open, so this is a short window.
- **Shown small and quiet:** tiny faded position emojis after the name in the roster list and the import preview. On the teams screen each team header gets a compact line, e.g. `🛡️2 🔄1 ⚡2` (players strong in each field position; a two-position player counts in both; a zero is greyed). It only appears when someone in the split has a position. No ratings are shown anywhere new; positions aren't shown on the home (attendance) screen or in the WhatsApp text.
- **Import:** `שוער` (and `gk`, `כן` in the keeper column) → 🧤 as before; `הגנה`/`מגן`/`בלם` → def, `קישור`/`קשר` → mid, `התקפה`/`חלוץ`/`כנף` → att, as whole words, so the card "לא חוזר להגנה" is not read as defence. The template gained an `עמדות` column.
- **Sample squad** has positions (and two two-position players) so the demo shows the team line.

### Balancing: the position spread term
- **Each player adds 1/len(positions) to each of his positions.** For each position P and team t the fair share is `total_P × size_t / n`; the term is `positionWeight × Σ_P max(0, Σ_t |count − share| − unavoidable_P)`. Players without positions don't count; with nobody having a position (or the weight at 0) the term is skipped entirely, so results are bit-for-bit what they were (tested: same pool for no positions, empty positions, and weight 0).
- **"Beyond what's unavoidable", like the keeper and leader rules.** 3 defenders in 5 v 5 can't do better than 2/1 (0.5 + 0.5 off), so that is subtracted: 2/1 costs 0 and 3/0 costs 2 units. The *difference* between 3/0 and 2/1 is the same as in the plain formula, so the ranking is unchanged; only the offset is gone. Without that offset an odd number of defenders would drag the 0–100 score down for every possible split, and it would widen the re-roll window (40% of best). The unavoidable part is computed for whole players (round shares down/up, ups go to the largest remainders). Two-position players (½ each) can sometimes beat that; the term is then clamped at 0, i.e. anything at least as even as the best whole-player split is free.
- **Fast:** per-player position fractions are precomputed in `buildProblem` (n × 3), and `aggregate` sums them per team only when the term is on. The 22-player tests stay at the same speed.
- **Weight 0.15 per player of avoidable deviation** (manager's suggestion was ~0.25). So "3/0 instead of 2/1" costs 0.3 rating points: about a typical balance cost, below the keeper (2) and leader (1) penalties, so a re-roll (+0.5 cap) can occasionally trade a little position spread for variety but never breaks a rule. Simulation (150 random squads per row, levels 2–9, 60% one card, 60% one position / 20% two / 20% none; balance score = `100·e^(−0.5·balance cost)` of the split chosen, i.e. level and attributes only; spread = avoidable position deviation of that split):

  | squad | weight | balance score | p90 / max drop vs no positions | avg level gap per player | avoidable spread | splits with spread ≥ 2 |
  |---|---|---|---|---|---|---|
  | 10, 2 teams | 0 | 88.6 | – | 0.13 | 1.71 | 65 / 150 |
  | | 0.1 | 87.2 | 4 / 8 | 0.16 | 0.23 | 3 |
  | | **0.15** | **87.0** | **5 / 8** | **0.17** | **0.19** | **2** |
  | | 0.25 | 86.1 | 7 / 12 | 0.18 | 0.07 | 2 |
  | 12, 2 teams | 0 | 91.0 | – | 0.10 | 1.64 | 70 |
  | | **0.15** | **89.4** | **5 / 7** | **0.12** | **0.02** | **0** |
  | | 0.25 | 89.3 | 5 / 13 | 0.12 | 0.01 | 0 |
  | 15, 3 teams | 0 | 83.0 | – | 0.15 | 2.48 | 94 |
  | | **0.15** | **80.8** | **6 / 8** | **0.17** | **0.13** | **0** |
  | | 0.25 | 80.5 | 6 / 8 | 0.17 | 0.09 | 0 |
  | 20, 4 teams | 0 | 78.0 | – | 0.17 | 3.96 | 128 |
  | | **0.15** | **75.7** | **5 / 12** | **0.19** | **0.13** | **0** |
  | | 0.25 | 75.5 | 5 / 12 | 0.19 | 0.10 | 0 |

  Already at 0.1 almost all stacking disappears; 0.15 removes nearly all of the rest for ~1.5–2.5 balance-score points on average, and the average per-player level gap between teams moves by only 0.02–0.04. 0.25 buys almost nothing more and doubles the worst cases on small squads. Level still dominates: it has weight 3 of 10 in the balance cost, and a one-point level difference between two teams' averages costs more than any realistic position spread.
- **The 0–100 score includes the (small) position term,** like it includes the keeper/leader rules. On the sample squad (5·5·4) the split stays the same as without positions; its score is 77 instead of 82 because a little spread is left that can't be fixed without hurting level balance more. *(my call: leaving it out of the score would make the shown score disagree with what the engine optimizes.)* Not editable in the UI, like the other penalties.
- **Borrowing and swap suggestions use the same cost, so positions count there too.** For borrowing, that means with equal levels the short team borrows the position it lacks against the team it faces (tested); level still decides first. Late-arrival swaps and the dominance swap simply see the extra term; nothing else changed.

## Penalties (v5)
The user: a level match (0–0 or any draw) is often decided by penalties in "winner stays".
- **Flow:** "סיום משחק" on a level score opens "מי ניצחה בפנדלים?" with the score ("תיקו 1–1") and two big team buttons (bib colour border and dot). One tap ends the match: the penalty winner stays, the loser goes to the back of the queue, exactly like a normal loss. The shoot-out score is optional, under a fold "תוצאת הפנדלים (לא חובה)" with two steppers; once it is unequal, the team behind can't be picked (no contradicting records). Level kicks (incl. the untouched 0–0) mean "not entered".
- **"תיקו בלי פנדלים"** (secondary button) leads to the old "תיקו. מי יוצא?" choice, unchanged. With exactly 2 teams it just records a draw. *(my call: 2-team draws now also see the penalties question, one extra tap for a plain draw, so a shoot-out there still counts.)*
- **Record:** `MatchRecord.pens = { winner, a?, b? }` (`a`/`b` = kicks scored by the record's a and b, only together and only if the winner has more). Copied to `EveningMatch.pens`. `cleanPens` validates both on load: winner must be a or b and the score level, else `pens` is dropped and the match reads as a plain draw; bad kicks are dropped but the winner kept. Old states and history load unchanged. Merging by id is unaffected (pens is plain JSON on the match).
- **How it counts (one rule everywhere, `matchWinner`):** a penalty win is a **win** for the winner and a **loss** for the other, never a draw: match-screen standings, streaks (`endMatch`), dominance hint, evening table, evening winner, "longest streak", per-player wins, all-time win %. **Kicks are never goals:** goals for/against, totals, top scorers, biggest win and most open match ignore them.
- **Where it shows:** the match list ("🥅 פנדלים 4–3 · ניצחו האדומים", kicks in the same order as the score above it); a summary highlight ("הוכרע בפנדלים" with the score line, or "N משחקים הוכרעו בפנדלים"); the champion line and the shared table add "(1 בפנדלים)"; the shared highlight adds "(פנדלים 4–3, ניצחו ה…)"; all-time shows a one-line note when any match was decided on penalties. The match-screen table has no separate penalties column *(my call: keep the pitch screen simple)*.

## Multi-delete and folds (v5)
User feedback: "Multiple delete? Where is the swipe delete of a player?" and "the arrow of 'דירוג מפורט מתקדם' is upside down".
- **Select mode on the players list.** A "בחירה" text button next to "N שחקנים" (beside "ייבוא רשימה"). In select mode each row shows a round check (filled black with a light tick, so it doesn't look like the green "present" tick), a tap toggles the row instead of opening the edit sheet (`aria-pressed`), the header button becomes "בחירת הכול" / "ביטול הבחירה", and a fixed bottom bar shows "נבחרו 3" with "מחיקה" (red, disabled with nothing picked) and "ביטול". Swiping is off in select mode (an open row closes). After deleting, select mode ends.
- **One confirmation, the same sheet.** `DeletePlayerSheet` takes a list: "למחוק 3 שחקנים?", the names ("אבי, בני וגיל"; past 6 names: "…ועוד 4"), and the same notes aggregated: in today's teams (naming him when only one of them is, "הם" when all are, "חלק מהם" otherwise), their pairs, synced group. The button says "מחיקת 3 שחקנים". One player keeps the old wording exactly.
- **One reducer action, `deletePlayers` (ids).** `deletePlayer` now calls the same code. The history-archiving wrapper and the sync see a single change, so a half-played evening is archived once, not once per player. Teams are cancelled if any deleted player (or sub) was in them; unknown ids return the same state.
- **Swipe is discoverable.** The first time the list has 2+ players, a small grey tip sits under the header: "טיפ: החליקו שחקן ימינה כדי למחוק, או ״בחירה״ כדי למחוק כמה בבת אחת." with a ✕. It's remembered per phone (`kochot:swipe-tip-seen`, via the never-throwing storage helpers) and also goes away after the first swipe delete. While the tip shows, the first row peeks at its red action once (a 1.4 s nudge), skipped under `prefers-reduced-motion` and as soon as the row is touched.
- **The revealed row no longer pushes the name off-screen.** Instead of sliding the whole row, the row's trailing edge follows the finger: the content shrinks from the left and the action shows behind it, so the name stays where it was and the level circle moves over. Same gestures, thresholds and full-swipe as v4. Rows are `user-select: none` so a desktop mouse drag doesn't start selecting text.
- **Fold chevrons.** The arrow was a "⌄" glyph rotated by `.fold[open] summary::after`, a descendant selector: an open "עוד על השחקן" also flipped the nested, closed "דירוג מפורט מתקדם". Now it's a drawn chevron (two borders, `currentColor`, so it works in light and dark): down when closed, up when open, with `.fold[open] > summary` so only the fold's own summary turns. All folds share it: player "עוד על השחקן" / "דירוג מפורט מתקדם", teams "פירוט האיזון", the match fold, Settings "מתקדם", the history folds.

## Editable match length (v5)
*Updates "Match night" (the length was only in Settings) and "Whistles and air horn (v4)".*
- **User feedback:** "the timer needs to be editable, we don't always play 8 minutes"; "there was no whistle when we started the timer".
- **From the match screen:** a small chip under the clock (`⏱ 8 דק׳`), and a tap on the big clock, open the "אורך המשחק" sheet: elapsed/remaining line, quick picks 5/6/7/8/10/12, a −/+ stepper (1–60), "+1 דק׳ / −1 דק׳" (added time) and a "בלי טיימר" switch. Changes apply at once; "אישור" just closes.
  - **A picked length (chip or stepper)** applies to the current match *and* becomes the default (`settings.matchMinutes`, shared with the group like before).
  - **±1 minute changes this match only** (injury time). The chip then shows a small badge, e.g. `9 דק׳ +1`. The next match goes back to the default.
  - **"בלי טיימר"** (new shared setting `matchNoLimit`, default off; also a switch in Settings → משחק): the clock counts up from 0:00, never turns red and never whistles by itself; the full-time whistle still plays on "סיום משחק". It stays on for the next matches until switched off (groups that play to a number of goals). *(my call: built, since it fit as "length = null")*
- **Math (pure, `match.ts`):** the clock is unchanged (elapsed time, timestamp based); the length only moves the finish line. `remaining = length − elapsed`, negative = overtime (shown as `+m:ss` in red, as before), `null` = no limit. A new length shorter than what was played goes straight to overtime. Lengths are whole minutes, clamped to 1–60.
- **Stored per match** as `match.length = { at, ms }` (`ms: null` = no limit), where `at` is the match number (`history.length`). It lapses by itself when the match ends, so `endMatch` didn't change. Old saved states have no `length` → the settings' default; `sanitizeMatch` drops a stale or malformed one and rounds to whole minutes. Settings without `matchNoLimit` → off.
- **Time-up whistle/vibration** use the effective length. Once per crossing *(my call)*: it fires when the running clock reaches the end; while the clock is in overtime, changing the length (e.g. −1) never fires it again; if the length is extended past the current time (or the clock is reset), there is time left again and the new end whistles/vibrates again. A length cut below the elapsed time while running counts as reaching the end (whistle). With no limit it never fires.
- **Sound fixes:**
  - **iPhone silent switch:** Web Audio follows the ring/silent switch by default, and phones at the pitch are usually on silent. When sounds are on, the app sets `navigator.audioSession.type = 'playback'` (Audio Session API, Safari 16.4+/iOS 17; feature-detected, in try/catch) so the whistle and horn play in silent mode. With sounds off it doesn't touch the session. Trade-off: the 'playback' category may pause music playing from another app while the match screen makes sound. Older iOS still mutes on silent; nothing a web page can do there.
  - **Suspended AudioContext (Safari):** a sound asked for while the context isn't `running` is scheduled after `resume()` resolves (dropped if that takes over 1.5 s), instead of on a frozen clock. A newer sound or mute cancels a pending one.
  - **The clock starts before any sound code runs,** and sound code never throws out of a tap. Before, an exception while creating/scheduling audio on the first tap would have kept "התחלה" from starting the clock.
  - **Whistle level:** a little less pea tremolo (0.68 ± 0.32) brings the blasts' RMS up ~0.6 dB, to about −10 dBFS against the horn's −13/−14 (at ~3 kHz, where phone speakers are loudest); peaks stay ≤ −1.4 dBFS (`npm run render-sounds`).
- **First tap on the match screen:** could not be reproduced (Playwright mouse click and touch tap, after navigating, after reload on `#match`, back/forward, and the app's browser pane: the first click always started the clock). `unlockOnNextTap` is a capture listener that never cancels or stops the event; toasts and the goal burst are `pointer-events: none`. The only real way found for the first tap to fail is an exception in the sound code, now impossible (above). Covered by `npm run e2e` (sound code broken on purpose, first tap still starts the clock) and `npm run sounds-check`.

## Back to the evening from the main screen (v5)
- **While an evening is on (there's a match state), the main screen's big button is "חזרה למשחק · משחק N"**, and "חלוקה מחדש" is a secondary text button that asks first. Before, the only button was "עושים כוחות", which silently re-split and ended the evening (the matches were archived to the history, but the live evening was gone) — a user hit this after pressing back from the match screen.
- With teams but no match yet, "חזרה לקבוצות" sits above "עושים כוחות" (a re-split there only replaces teams, so it doesn't ask).

## Extra time on a draw, simpler penalties (v5, user feedback)
- **Level when the time runs out → a whistle (short-long) and automatic extra time**, default **2 minutes** (Settings → משחק → "תוספת זמן בתיקו": בלי / 1 / 2 / 3 / 5). It's added once per match (`MatchState.extraAt`); a note under the clock "תיקו · תוספת זמן +2 דק׳ · שינוי" opens the length sheet to edit it. When the extra time ends the normal full-time whistle blows; if it's still level, "סיום משחק" asks about penalties. A shared group setting (old phones drop it → back to the default 2).
- **Penalties are one tap:** the sheet is just "תיקו. מי ניצחה בפנדלים?" with two team buttons and a small "בלי פנדלים, תיקו". The optional shoot-out score (kicks) was removed from the UI — the user found it too complicated. Old records with kicks still load and show them; new ones store only the winner.

## Organizers and invite links (v6)
*Updates "Groups, login and sync (v3)" → Server / Invites ("revoking exists in the schema, not in the UI yet").*
- **Where:** groups sheet → for a cloud group, while logged in, a "מארגנים והזמנות" button (under "הזמנת מארגן") opens a sub-sheet with a back link to the group. Hidden for local groups and when logged out. It loads only when opened; offline it shows "צריך חיבור לאינטרנט" + "נסו שוב" and reloads by itself when the phone is back online. A lost session shows "צריך להתחבר שוב לחשבון" + login.
- **Organizers list:** name, "(את/ה)" for the current user, "הצטרפ/ה ב־<date>", oldest first, and a one-line reminder that every organizer sees and edits everything, ratings included.
- **Names without a profile table:** `group_organizers(group_id)` (security definer body in `private`, thin security-invoker wrapper in `public`, like the v3 RPCs) returns `(user_id, display_name, role, joined_at, is_me)` only for a group the caller belongs to; anyone else gets "not a member" (42501), `anon` can't call it. `display_name` = the login's own name (`full_name`/`name` from Google) or else the part of the email before the @, capped at 40 characters. **The full email is never returned**, and `auth.users` isn't exposed any other way. *(my call: a profiles table would need sign-up triggers and its own RLS for one field; the local part is enough to tell organizers apart.)* Names are shown in `<bdi>` so Latin names don't scramble the RTL line.
- **Invite links:** the live ones (not revoked, not expired), newest first: "נוצר ע״י <name / את/ה / מארגן/ת לשעבר> ב־<date>", "בתוקף עוד N ימים, עד <date>". Each has share (native share, else copy) and "ביטול" with an inline confirm ("מי שכבר הצטרף נשאר בקבוצה"). "קישור חדש" creates one (still 14 days) and opens share. Read straight from `group_invites` (the existing members-only select policy).
- **Revoking goes through `revoke_invite(token)`** (same private/public pattern): members of the link's group only; unknown tokens and other groups' tokens give the same 42501; it only ever sets `revoked_at = now()` on a live link (idempotent). **The direct `UPDATE (revoked_at)` grant and its policy were removed**, because they let any member un-revoke a link (set it back to null) or post-date it. A revoked token already fails `join_group` with the usual "invalid invite".
- **Revoking doesn't remove anyone**, and **organizers can't remove each other in this version** *(my call: with only one role, any organizer could kick out the group's creator; that needs an owner/admin notion first)*. Leaving stays as it was (the last one out deletes the group).
- **SQL:** `supabase/migrations/20261020120000_organizers_invites.sql`, applied to project `cieyeoyuwddobrxjcffw` as migration `organizers_invites`. Verified with three simulated users in a rolled-back transaction (member sees both organizers with names and `is_me`, sees invites, can revoke, can't UPDATE directly; non-member gets 42501 / 0 rows / can't revoke; revoked token can't join; anon is denied). Security advisor: no findings.
- **Client:** `src/sync/organizers.ts` (pure parsing/formatting, unit-tested), `remoteApi.listOrganizers / listInvites / revokeInvite`, `src/ui/OrganizersSheet.tsx`.

## Add to home screen (v6)
- **Why:** iOS Safari may delete a site's saved data after ~7 days without a visit unless the app is on the home screen; installed, it also opens full screen at the pitch.
- **When (my call):** from the **second use** on. A use starts when the app is opened (or comes back to the foreground) with players in the roster, at least **12 hours** after the previous use began, the same gap as the new game day. So the first evening, even one that runs past midnight, is one use, and the card can first appear on the next game day (or later the same day, if the roster was set up in the morning). Pure rule: `shouldOfferInstall` / `recordUse` in `src/state/install.ts` (unit-tested).
- **Never:** on the first use; while a match clock runs; off the main screen; when opened from the home screen (`display-mode: standalone|fullscreen|minimal-ui|window-controls-overlay` or iOS `navigator.standalone`); after `appinstalled`; or where installing isn't possible (no captured prompt and not iOS: e.g. Firefox desktop, or Android before Chrome fires its event, so an installed Android app opened in the browser isn't nagged).
- **Where:** a card at the top of the main screen, in the page flow (not a sheet or a fixed banner), so it never covers the big button or the clock. It is counted before the first render, so it doesn't pop in above the list.
- **Android / Chromium:** `beforeinstallprompt` is captured as soon as the app loads (default mini-infobar suppressed) and the card has one "התקנה" button that calls `prompt()`. Declining in the browser's dialog counts as "אחר כך".
- **iOS (no API):** two illustrated steps: Safari's share icon (inline SVG) "בסרגל למטה" on iPhone / "למעלה, ליד הכתובת" on iPad (iPadOS detected by "Macintosh" + touch), a note for iOS 26 where share sits under "···", then "הוספה למסך הבית" → "הוספה". Chrome/Firefox/Edge on iOS: share "בשורת הכתובת". Known in-app browsers (Instagram, Facebook/Messenger, Line, Telegram, Snapchat, TikTok, LinkedIn, X, the Google app; their user agents say so) get "open in Safari first". WhatsApp's in-app view looks exactly like Safari, so Settings adds "no 'add to home screen'? open it in Safari first".
- **Dismiss:** "אחר כך" hides it for 7 days; "לא להציג שוב" for good. Per-phone flags in `kochot:install` (`uses`, `useAt`, `snoozeUntil`, `never`, `installed`), read/written through the try/catch storage helpers; never synced, never in the backup.
- **Settings → "התקנה במסך הבית"** is always there with the same steps (or the install button), or says it's already installed. Desktop/other browsers see short iPhone and Android instructions.
- **Manifest / iOS tags:** added `id`, `purpose: any` on the plain icons, `categories`, a 180 px `apple-touch-icon.png` (generated by `scripts/icons.mjs`, precached), `apple-mobile-web-app-status-bar-style: default` (light status bar; `black-translucent` would put white status text over the light background) and `mobile-web-app-capable`. Already fine: Hebrew name/short_name, `lang`/`dir`, 192/512 + maskable (the ball sits inside the safe zone), colours, `display: standalone`, `start_url`/`scope` `./` (works with `base: './'` and hash routes).

## Left early (v6)
The mirror of late arrivals: someone leaving never reshuffles everyone. Pure logic in `src/state/leave.ts`, reducer actions `leave` and `subIn`, UI in `src/ui/LeaveSheet.tsx`.
- **Where:** "עזב באמצע" next to "הגיע מאוחר" on the teams screen, and "מישהו עזב?" under the pitch on the match screen. One sheet: pick who left (chips by team; the teams on the pitch are marked "על המגרש"; subs last) → a confirmation that says what will happen ("הכחולים נשארים 4", "X נכנס במקומו", …) → an optional small fix.
- **What leaving does:** he comes off his team (or the bench), his team's keeper rotation, any borrow for the current match, and today's attendance. The re-roll pool is dropped (it's for the old roster; a re-roll searches again, as after a late arrival). Because attendance and the teams change together, the result is **not** flagged "changed since the split" (`isResultStale` needed no change). Ticking him again at home later does flag it, which is right (use "הגיע מאוחר" instead).
- **Keepers:** whoever is in goal now stays in goal; if the keeper himself left, the next one in the rotation takes over. The rotation is "goals conceded mod team size", so the list is rotated to keep the keeper under the index (`keepKeeper`). A sub who comes in goes last in the rotation, same rule. *(my call)*
- **History stays truthful:** finished matches keep him in their `sides` (they were stamped when each match ended; an older record without `sides` is stamped with the rosters just before he leaves). His goals stay his. The match in progress is credited to whoever finishes it (its sides are stamped at the end, without him). *(my call)*
- **The small fix (`suggestAfterLeave`), only when his team is now short:**
  - With subs: the sub who fits his team best (lowest engine cost with him in), with the balance score before and after; other subs are one tap away, or "להשאיר ככה". A sub may come in even in the middle of a match: that's what subs are for.
  - Without subs: up to 2 swaps from `suggestSwaps` (same 0.03 minimum gain as the late-arrival flow), score before/after, accept or keep. `suggestSwaps` got an optional `locked` list of teams: **the two teams of a match under way** (clock ran or a goal) are never swapped, nor the short team and its lender once a borrow is decided. If his own team is one of them, nothing is offered: they play one short, and from the next match a short team borrows from the loser as usual (with a queue).
- **Too few players:**
  - The short team waiting outside that drops below the format's minimum (a remainder missing more than 2, i.e. `max(2, size − 2)`, the `planFormat` rule) **goes to the bench**: its players become subs and the team is removed, so the line-up matches what a fresh plan would say (e.g. 5·5·3 → one leaves → 5·5 + 2 subs; the home plan line, which follows attendance, says the same). Only when it is the last team, not on the pitch and hasn't played yet, so no team changes colour/index and the evening's records still point at the right teams.
  - Otherwise a team keeps playing short down to **2 players** (the split's minimum). One more leaving: the best sub comes in automatically; with no sub it's refused ("אי אפשר… צריך חלוקה מחדש"), since a re-split is the honest answer there.
- **On the teams screen, any short team shows "משלימים N" when there is a queue** (before: only teams from the third on), because a team that lost a player also borrows from the loser.
- **Known edge:** the evening id is derived from the players in the split (as after a late arrival), so ending an evening, starting again with the same teams, someone leaving and ending again saves two records instead of merging them.

## Email login on the free plan (v6)
- **Supabase's free plan doesn't allow editing the email templates without custom SMTP**, so the default "Magic link" email has a link and no code. The login option is therefore labelled "קישור למייל": the app sends the email and says to open it **on the same phone** and tap the link (the PKCE link only completes in the browser that asked for it). The code field stays, for when Resend/SMTP is set up and the template includes `{{ .Token }}`.
- Deployed at https://soccer-team-tau.vercel.app (Vercel, auto-deploys the `claude/loving-allen-zp89uf` branch). Supabase Site URL and redirect URLs set by the user (2026-10-20).

## Animal cards and "good in goal" (v7)
The user: cards should be clear animals/symbols ("🧱 לבנים isn't clear"), and "not everyone marked goalkeeper has to be the goalkeeper; he's good in goal but may not want to, because we rotate". This supersedes the v3 card list and the v4 "a 🧤 player starts in goal" rule.

### The cards
Short names without the "ה" prefix, as the user wrote them. 6 strengths, 7 weaknesses (the user's list; the count no longer has to match, the *size* of a card does, see below).

| | card (id) | blurb | deltas | sum | opposite |
|---|---|---|---|---|---|
| 💪 | 🦍 גורילה (`beast`) | גדול, חזק, ואף אחד לא עובר אותו בכתף | defence +3, stamina +2, shooting +1, dribbling −1 | +5 | 🥶 מפחד מהכדור |
| | 🐆 צ'יטה (`cheetah`, new) | עד שהסתובבת, הוא כבר ליד השער | stamina +2, dribbling +2, defence +1 | +5 | 🐢 איטי |
| | 🎯 מדויק (`sniper`) | מסירה לרגל, בעיטה לפינה | passing +3, shooting +3 | +6 | 🫏 חמור |
| | 🪄 קוסם (`magician`) | עובר שלושה, מאבד ברביעי | dribbling +4, passing −2, teamwork −2 (unchanged) | 0 | – |
| | 🧠 מוח (`brain`) | רואה את כל המגרש ומחלק כדורים | passing +4, teamwork +2 (unchanged) | +6 | 🙅 לא מוסר |
| | ⭐ כוכב (`captain`) | מסדר, מעודד ומרים את כולם | leadership +4, teamwork +1 (unchanged) | +5 | 🌱 מתחיל |
| 🩹 | 🫏 חמור (`donkey`, new) | לב זהב, אבל ליד השער שלנו הכול יכול לקרות | defence −2, teamwork −2, passing −1 | −5 | 🎯 מדויק |
| | 🦥 עצלן (`noDefense`) | שומר כוחות להתקפה הבאה | defence −4, stamina −1, teamwork −1 | −6 | – |
| | 🐢 איטי, 😮‍💨 נגמר אחרי 5 דקות, 🙅 לא מוסר, 🥶 מפחד מהכדור, 🌱 מתחיל | unchanged | unchanged | −5/−5/−6/−6/−5 | צ'יטה / – / מוח / גורילה / כוכב |

- **Balance of the set:** every card except the style card 🪄 moves the player by 5 or 6 points in total; strengths average +5.4 (without 🪄), weaknesses −5.43. So one strength and one weakness roughly cancel, whichever two. Tested. No single delta is bigger than 4, as before.
- **Why these deltas:** 🦍 is size and duels (defence first, a heavy shot, not nimble). 🐆 is the exact mirror of 🐢 (fast both ways, so also back in defence). 🎯 is the user's "passes right *and* shoots accurately", so both equally (the old sniper was shooting +4, passing −1). ⭐ is the old captain's role, so its deltas stay. 🫏 "critical mistakes": defence and teamwork (losing the ball in our half, the wrong pass), a little passing. 🦥 is the old "doesn't track back" plus a bit of work rate (stamina −1).
- **Opposites** (picking one drops the other): 🦍↔🥶, 🐆↔🐢, 🎯↔🫏 (precise vs. the costly mistake), 🧠↔🙅, ⭐↔🌱. 😮‍💨 lost its partner (the old 🦍 "runs 90 minutes" was stamina; the gorilla is size): a 🐆 who's 😮‍💨 is a real type ("starts like a rocket"). 🦥 and 🪄 have none: a lazy star or a lazy magician exist. *(my call)*

### Migration (stored ids never change)
- **Ids kept, labels changed:** `beast` → 🦍 גורילה, `sniper` → 🎯 מדויק, `captain` → ⭐ כוכב, `noDefense` → 🦥 עצלן, the rest as they were. New ids `cheetah`, `donkey`. Players from older phones, backups and synced docs load as before.
- **🧱 `rock` is dropped; it becomes the 🛡️ הגנה position** (its meaning was "holds the defence", which positions now cover). *(my call: not mapped to 🦍, because the rock was about position and organising, not size.)*
- **Ratings:** ratings are stored, so cards whose deltas changed (beast, sniper, noDefense, rock) would otherwise look "hand-tuned" and still carry the old meaning. `migrateCards` (called from `sanitizePlayer`) recomputes level + today's cards **only if the stored ratings are exactly what level + cards gave with the old deltas**; hand-tuned ratings are never touched (the card is dropped/renamed, the numbers stay). It's idempotent and deterministic, so every phone migrates the same way and the 3-way sync merge sees no conflict. A phone still on v6 sees a migrated player as "hand-tuned" until it updates; if it re-levels him, the next v7 load migrates him again.
- **Old v6 combinations that are now opposites** (e.g. old החיה + מפחד מהכדור) keep the later card, as an import does.
- **Import:** old words still work as aliases: החיה, הצלף, הקפטן, הקוסם, המוח, לא חוזר להגנה / לא חוזר. Also הגורילה, הכוכב, קפטן, צלף, מדוייק, צ׳יטה (Hebrew geresh), ציטה, מהיר, העצלן, החמור. `הסלע` now reads as the defence position.

### 🧤 "טוב בשער" (good in goal)
- **The chip is now "🧤 טוב בשער"** (still `canGK`). Hint under the chips: rotating mode "לא חייב לעמוד בשער. כשהשוערים מתחלפים כולם נכנסים בתורם."; fixed-keeper mode "במצב שוער קבוע, האפליקציה תדאג שבכל קבוצה יהיה אחד כזה (אם יש מספיק)".
- **Rotating keepers: the order is random again** (`keeperOrder`). A 🧤 player no longer starts in goal; he's just one of the turns. The random stream is unchanged (same shuffle), so the order equals that of a team without a 🧤. Fixed mode is unchanged (🧤 players first, one per team when possible).
- **Wording:** the teams-screen "why not 100" line now says "יש קבוצה בלי שחקן שטוב בשער, למרות שיש מספיק". Import accepts "טוב בשער" (and still שוער / כן / gk); the template column is "טוב בשער" with "כן". *Not changed (another worker owns it): Settings → fixed keeper still says "מסמנים בכרטיס השחקן ״שוער קבוע״"; it should say "״טוב בשער״".*

## Optional bibs, tidier settings (v7)
User feedback: "we don't have bibs — make it optional, by default team 1, 2, 3"; "many settings should be folds, e.g. installing to the home screen — call it something like 'גישה מהירה'"; "I didn't really understand the pairs thing".
*Updates "UI" ("Teams are named by bib colour") and "Add to home screen (v6)" (Settings → "התקנה במסך הבית").*
- **New shared setting `hasBibs` ("יש לכם גופיות?"), default off.** Off: teams are "קבוצה 1", "קבוצה 2"… everywhere (teams, match, toasts, borrow card, left early, penalties, share text, summary, history, standings), each with a fixed colour: blue, orange, purple, green, red, yellow, black, white (the bib colour tokens, so they already work in light and dark; blue/orange first because they're the most distinct pair). On: the old bib picker. `bibs` is kept while off, so switching back restores the colours. Synced with the group (not in `LOCAL_SETTINGS`).
- **One naming helper.** `teamLook()` now returns `name` ("אדומים" / "קבוצה 1"), `the` ("האדומים" / "קבוצה 1"), `to` ("לאדומים" / "לקבוצה 1"), `from` ("מהאדומים" / "מקבוצה 1"), `in` ("באדומים" / "בקבוצה 1") and `plural`; `verb(look, 'ניצחו', 'ניצחה')` picks the agreeing verb. No code glues "ה" to a name anymore. Examples: "קבוצה 1 ניצחה בפנדלים · קבוצה 2 יוצאת · נכנסת קבוצה 3", "משלימים את קבוצה 3 מקבוצה 2", "הבאה: קבוצה 3", "קבוצה 1 לקחה את הערב", "בקבוצה 2 נשארים 4" (the left-early lines use the "in" form in both modes, e.g. "באדומים נשארים 4"). *(my call)*
- **Migration (`sanitizeSettings`):** an explicit boolean wins. Without one (data from before v7), a group whose bib list differs from the untouched default (all 8 in the default order) chose its colours → bibs on; the default list → off. Invalid → off. Caveat: a phone on an older version drops the unknown field when it writes settings; the next new phone then re-derives it from `bibs`, so a group that turned bibs on *without* changing the list could flip back to off until everyone updates.
- **History:** each team stores a stable id: the bib id with bibs, `n1`, `n2`… without (`teamBibs()`). Display (`bibLook()`) reads bib ids, `nN`, and old records' `''` (more teams than bibs) as "קבוצה <position>". With bibs on but fewer bibs than teams, the extra teams are numbered too (and stored `nN`).
- **Settings layout:** "משחק" (length, no timer, extra time on a draw, sounds) stays open. Everything else is a fold with a value in the summary row: מראה · לפי הטלפון, שוערים · מתחלפים כל גול, גופיות · אין / 8 צבעים, כללים בין שחקנים · 2 / אין, גישה מהירה · הוספה למסך הבית / במסך הבית, חשבון וסנכרון · מחוברים / לא מחוברים, גיבוי ושיתוף הסגל, מתקדם · משקלים באיזון, נתונים. Same chevron rule as v5 (`.fold[open] > summary`). Which folds are open is remembered per phone (`kochot:settings-open`, via the never-throwing storage helpers; not synced, not in the backup). New component `SettingsFold.tsx` (kept out of `components.tsx` to avoid clashing with the cards work). No help/FAQ row was added; the manager wires it.
- **Pairs → "כללים בין שחקנים":** a two-line explanation with examples ("לא באותה קבוצה": two brothers who always argue, or the two keepers; "תמיד באותה קבוצה": came in the same car and leave together), the switch says those two phrases, the button is "הוספת כלל", and list items read "דני ויוסי · לא באותה קבוצה" with ✕. Same data (`constraints.apart/together`). The teams-screen warnings and the delete confirmation use the same words.
- **Tests:** `src/state/teamNames.test.ts` (both modes, grammar, stored ids, old records, migration, backup round-trip, history ids through the reducer). e2e: folds start closed, the rule is added from its fold and listed in plain words, numbered teams with 3 different colours, bibs switched on → bib names on teams/scorer sheet/borrow card. Screenshots `11` (closed), `11b` (all open), `11c`/`11d` (bibs off/on), `16d` (quick access open).

## Help screen (v7)
User: "add questions and answers: what the icons are, and an explanation of things". Friends who aren't the organizer use the app too.
- **Route `#help`, "שאלות ותשובות".** Opened from a "?" icon at the end of the main top bar (quieter colour than the other icons), from a row at the top of Settings, and from a small "?" next to the balance score on the teams screen (`#help/score` opens that question and scrolls to it). "Back" returns to the screen it was opened from (home, teams, match, players or settings), not always home.
- **Content is data, in `src/ui/help.ts`** (sections → questions → short paragraphs and/or legend rows), separate from `HelpScreen.tsx`, so the wording is easy to edit. Each question is a `details.fold`, all folded at first. Four sections: "מה אומרים האייקונים?", "החלוקה", "ערב משחקים", "שחקנים, קבוצות וטלפון".
- **The icon legend is generated from the data:** `ALL_POSITIONS` (with 🧤 explained as "good in goal, not necessarily the keeper"), `STRENGTHS` and `WEAKNESSES` from `CARDS` (emoji, name, one-liner), and the position-count line from `FIELD_POSITIONS`. Answers that mention examples (cards, attributes, `MAX_CARDS`, the 🧤 emoji, the field positions) are built from the same constants. `help.test.ts` checks that the legend lists exactly the cards and every position; `npm run e2e` reads the card and position chips from the add form and checks each one appears in the legend. The fixed icons (score, keeper order, ⏱, +1, 🔁, 🥅, sound, history highlights 🏆👑🏅🔥💥🎯🥅📅, the top-bar icons and the sync dot colours, drawn with the real `sync-dot` classes) are listed by hand. The © leader mark isn't shown anywhere in the current UI, so it isn't listed.
- **Search box** (cheap: plain substring match over question, answers and legend; every word must match). While searching, every match is open.
- **Written for the new behaviour being built in parallel:** no bibs by default ("קבוצה 1, 2, 3" with automatic colours, bibs switched on in Settings) and "כללים בין שחקנים" instead of "זוגות". *(manager to check the wording against the merged UI.)*
- **Ranges are written in words** ("מ־0 עד 100", "בין 80 ל־95"): a "0–100" in an RTL line renders as "100–0" and looks like a score.
- The Settings change is one `<HelpLink />` line plus its import, so it merges with the Settings reorganisation.

## Help screen trimmed (v7, user feedback)
- **The user found the help screen far too long ("יותר מדי").** It now has only: **דירוג שחקנים** (level 1–10, positions, strengths, weaknesses — the legends still come from the data) and **עוד** (the 0–100 score, rules between players, what happens on a draw, who sees ratings, why add to the home screen), each one or two lines. Removed everything obvious from using the app (winner stays, borrowing, subs, keeper modes, detailed rating, team numbers, history, sync steps, icons legends for teams/history/top bar).
- **Top bar order (RTL, right → left):** history · ? · players · settings, so the "?" sits right of the players icon and settings is at the far left.
- Rule for the future: help covers only what isn't obvious from the screen itself; keep answers to one or two lines.

## Settings: essentials open, the rest folded below (v7, user feedback)
- Order: שאלות ותשובות · **משחק** (open) · folds: שוערים, גופיות, מי עם מי, חשבון, שיתוף הסגל וגיבוי, הנוסחה לחלוקה · **מראה** (open, near the bottom) · נתונים (fold, last).
- Renames: "כללים בין שחקנים" → **"מי עם מי"**; "גיבוי ושיתוף הסגל" → **"שיתוף הסגל וגיבוי"**; "מתקדם" → **"הנוסחה לחלוקה"** (summary: "כמה כל תכונה שוקלת"); "חשבון וסנכרון" → **"חשבון"**, with a one-line "why" (only needed when another organizer manages the group from their phone).
- **"סנכרון עכשיו" removed**: syncing is automatic (on open, focus, back online, every minute and after each change), so the button only raised questions.
- **"Add to home screen" moved out of Settings** into the help screen as "איך מוסיפים למסך הבית?", showing the live steps / install button (`InstallHelp`). The main-screen prompt on the second use is unchanged.

## Login polish and help links (v7, user feedback)
- **Sign-up with a password asks for it twice** ("סיסמה שוב"); a mismatch says "הסיסמאות לא זהות". Sign-in stays one field.
- **"המשך עם Google" shows Google's four-colour G** (inline SVG on a white circle, so it reads in dark mode too) instead of a blue letter.
- **Help answers can open the right Settings section:** "מי עם מי" → button "להגדרת מי עם מי" unfolds that section (`#settings/rules`); "מה קורה בתיקו?" says the default (2 minutes extra, then penalties) and "לשינוי" goes to the game settings (`#settings/game`). Settings scrolls to `set-<section>`.

## Share as a picture (v8)
- **"שיתוף" on the teams screen shares a PNG of the teams** with one line, "הכוחות להערב ⚽". The picture is 1080 px wide and always light: a card per team in its colour with the name ("קבוצה 1" or the bib name), "בחוץ" / "בתור #N" for teams waiting, the players (🧤 on whoever starts in goal, same rule as the screen), the subs, and a small "כוחות". No ratings, cards or score. Drawn on a `<canvas>` (`src/shareImage.ts`, RTL, Heebo), up to three teams side by side, more in rows of two.
- **The picture is drawn ahead** (300 ms after the teams change), so the tap opens the share sheet straight away; iOS only allows sharing inside the tap.
- **No file sharing (most desktops):** the PNG is downloaded and the short text copied ("התמונה נשמרה והטקסט הועתק"). The separate "העתקה" button and the wa.me fallback are gone. *(my call: one button covers it.)*
- **Shorter text:** a title line, one line per team (`🔵 *קבוצה 1*: אבי, בן…`) and the subs. Keeper order, borrow lines, the date and the balance score are dropped. RLM on every line stays.
- **Evening summary:** text only, shortened: date line, the winner, the table, the highlights; no blank lines, numbering or totals. *(my call: the summary is already short; a picture there wasn't worth the code.)*

## Late arrival: in now or wait (v8)
Supersedes "Late arrivals" (v2): a late arrival no longer joins the smallest team automatically. User: "maybe they're playing right now", "maybe they want to keep playing 3×3 and not go up to 4×3", and "there is no 'his' team, it's pickup".
- **Always ask.** "הגיע מאוחר" (teams screen) and the new "מישהו הגיע?" (match screen, next to "מישהו עזב?") open one sheet: pick or add the player → title "דני הגיע", one context line ("משחק באמצע · קבוצה 1 נגד קבוצה 2" / "בין משחקים" / "עוד לא התחיל משחק") → **"נכנס עכשיו לקבוצה 3"** or **"מחכה בצד"**. Between them, chips of the other teams: one tap puts him there instead.
- **"נכנס עכשיו"** goes to the suggested team (`nowTarget`): the smallest team that isn't full, ties to the later team (outside rather than on the pitch). All full: a new team if he and the subs reach the threshold (`max(2, size − 2)`, as before), else the smallest team (it grows by one). If that team is on the pitch mid-match he joins it now. He goes last in its keeper rotation and whoever is in goal stays there (`subIn`/`keepKeeper`, as in left early). Into a short team with borrowers, he takes a borrower's place (the borrow shrinks or clears). Follow-ups as before, only when he joins: the swap suggestion when he completed the teams (now never touching the two teams of a match under way or a borrowing pair, like left early), and a new team joins the back of the queue.
- **"מחכה בצד"** makes him a sub; nothing else changes, and subs never turn into a team by waiting. He comes in the usual way: on the teams screen tap the sub, then a player (one line under the bench says so).
- Attendance and teams change together, so the teams aren't flagged "changed since the split". Pure logic in `src/state/late.ts` (tests `late.test.ts`); the reducer's `lateJoin` action now carries the choice and a seed. UI `src/ui/LateSheet.tsx`.
