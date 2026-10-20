# STATUS (v2)

## What was built
- **Main screen "מי הגיע היום?" (who came today?):**
  - Attendance ticks, with "everyone", "clear" and "same as last time".
  - Players-per-team pills (3–7).
  - A one-line plan, e.g. `5 נגד 5 · 4 בחוץ, משלימים 1 מהמפסידה`.
  - One big **עושים כוחות** ("make teams") button.
- **Teams screen:**
  - Animated 0–100 balance score, and bib-coloured team columns that "deal" in.
  - A keeper rotation order per team, and a subs bench.
  - Tap-to-swap, including subs, with undo.
  - Re-roll, WhatsApp share, copy.
  - **Late arrival** without reshuffling, plus a swap suggestion when the teams fill up.
  - Rule warnings, and a folded table of per-team averages.
- **Match night:**
  - Countdown timer: overtime, wake lock, vibrate/beep, survives reloads.
  - Goals with optional scorer, and undo goal.
  - Winner stays / loser to the back of the queue, and a draw picker.
  - The evening's standings and top scorers.
  - A **dominance hint** with a one-swap fix.
  - **Borrowing from the losing team (v3):** when a short team is on the pitch, an optional card suggests who comes over from the team that just lost, so the next match is as even as possible. You can tap someone else, or skip. Borrowers play that match only, and they can be picked as scorers.
  - **Match sounds (v4):** a referee pea whistle at kick-off (short-long, not on resume) and at full time (short-short-long: time-up or the end tap, once per match), and a synthesized stadium air horn on goals, plus the "גוֹל!" burst. No announcer or crowd. Setting "צלילים: פועל / כבוי" and a mute icon on the match screen. `npm run sounds-check` verifies the timing in a browser; `npm run render-sounds` renders WAVs.
  - **Editable match length (v5):** tap the clock or the `⏱ 8 דק׳` chip: quick picks / stepper (this match + default), ±1 minute for this match only, or "בלי טיימר" (counts up). Whistles play in iPhone silent mode (Audio Session 'playback'); see DECISIONS.
  - "End the evening".
- **Players screen:**
  - Quick add: name, level 1–10 (with a one-line scale hint), up to 3 of 12 player cards in two rows (6 strengths, 6 weaknesses).
  - Optional "דירוג מפורט" (detailed rating) sliders, folded in quick add and open in the edit sheet.
  - **List import:** paste text or upload CSV/TXT/JSON, preview before adding, downloadable template (`docs/roster-template.csv`).
  - **Swipe to delete (v4):** drag a row to the right to reveal a red "מחיקה"; it (and the edit sheet's delete) asks "למחוק את …?" first. Covered by `npm run e2e` (real touch swipe, vertical scroll, cancel, confirm).
- **Settings:**
  - Rotating vs. fixed keepers, and switch every 1/2/3 goals.
  - Match length. Bibs are optional (v7, off by default): without them teams are "קבוצה 1", "קבוצה 2"… in fixed colours; with them, the bib colours you own, in order.
  - Look: light, dark or follow the phone, and a main colour (green, blue, purple, orange, pink).
  - "כללים בין שחקנים": "לא באותה קבוצה" / "תמיד באותה קבוצה" (stored as keep-apart / keep-together pairs).
  - v7 layout: only "משחק" is open; the rest are folds with a one-line value (remembered per phone in `kochot:settings-open`). Install help is "גישה מהירה".
  - Backup link for a second organizer, backup file download.
  - Advanced weights and leadership threshold; sample squad; wipe.
- **Under the hood:**
  - Engine v2: new attributes, explicit sizes, `planFormat`, `suggestSwaps`, `suggestWeakeningSwap`, optional goalkeeper rule.
  - Pure match module.
  - State v2 with migration from v1.
  - PWA: manifest, icons, service worker. Heebo font.

## What was tested
- **`npm test`: 57 Vitest tests pass.**
  - Engine: optimality vs. brute force, sizes, constraints, leaders/keepers, determinism, re-roll, 22 players under 1 s.
  - Format plans: 10/11/12/13/14/15 players at 5-a-side, 9/10/11 at 4-a-side, the reduced 8→4v4 case.
  - Explicit sizes, and the goalkeeper rule turned off.
  - Swap suggestions and the weakening swap.
  - Match: queue rotation, 2-team mode, draws, goals/undo/conceded, clock across pauses, dominance and dismissal, keeper rotation, sanitizing.
  - State: v1→v2 migration, new-day reset, cards, late arrival (short team / bench / new team / filled / reduced), swap and sub swap keeping keeper slots, reset swaps, sample merge.
  - Import parsing (CSV, free text, BOM, header, duplicates, bad levels), merge, backup-link round-trip.
  - Share text.
- **`npm run build`:** type-check and production build pass.
- **`npm run screenshots`** (390×844, light and dark): every screen and sheet, with no console errors, no horizontal overflow, and RTL direction. I reviewed the screenshots by eye. Fixed during review:
  - The toast was covering the match clock.
  - The waiting team was cramped in a half column (it's now a full row with names in two columns).
  - Two buttons had the same accessible name.
- **`npm run e2e`:** the full flow in a real browser.
  - Quick add with cards, duplicate rejection, the not-enough state.
  - Pasted list import with preview.
  - Persistence; 22 players at 5-a-side → 5·5·5·5 + 2 subs in about 350 ms; re-roll.
  - A late arrival forms a new team of 3 and leaves the other teams untouched.
  - A match: goal, end, the pitch rotates, standings.
  - Keep-apart respected.
  - The new-day reset with "same as last time".
  - A backup link opened in a fresh browser imports all 23 players.

- **Borrowing (v3):** 8 unit tests for the suggestion (best gap, weighted attributes, 2 borrowers, ties, keep-apart/together, edge cases) and 3 for the match state (who borrows from whom, the short team that stays borrows again, skip, sanitizing old states). The e2e drives the sample squad (14 → 5·5·4) through a match end, overrides the suggestion, scores with the borrower, reloads, and checks the borrow repeats from the new loser. Screenshots `10b`–`10d`.

## Known limitations
- **Not tested on real phones:** the native share sheet, the iOS wake lock and vibration (iOS has no vibration API), and the install-to-home-screen flow were not checked on actual devices.
- **First visit needs a connection:** the service worker caches on first use, so if the very first visit is offline, nothing is cached yet. Also, iOS only stops evicting local data once the app is added to the home screen; since v6 the app suggests that from the second use (see below).
- **Swap suggestions aren't browser-tested:** the "teams filled" suggestion and the dominance hint are unit-tested, but the browser flow doesn't trigger them.
- **History is per phone:** past evenings (results, scorers, who played) are saved on the phone that ran the match and in the backup *file*, not in the backup link. Who was borrowed from the losing team isn't recorded, so borrowers' wins aren't counted.
- **Fixed design limits:** the main screen offers 3–7 per team (larger sizes aren't reachable), there are 8 bib colours, and cards are a fixed list (12).
- **The backup link can get long** for very large rosters (it's roughly 1–2 KB for 25 players, which is fine for WhatsApp).

- **Proposal, not built (changes balancing, so it needs the user's OK):** when the plan has a short team, pick the split from the near-optimal candidates (within +0.05) by how even the match is with the best borrower from each possible loser. In a simulation this raised the worst case from ~85 to ~88, at a cost of ~0.015 rating points in the split itself.

## Next steps, most valuable first
1. **Try it at a real game** on 2–3 phones (iOS and Android): share, wake lock, install, offline. Then fix what hurts.
2. ~~**"Add to home screen" prompt** after the second use, so iOS keeps the data.~~ Done (v6).
3. **"Left early" button** on the teams and match screens: remove a player and suggest one swap.

2. **"Add to home screen" prompt** after the second use, so iOS keeps the data.
3. **"Left early" button:** done (v6, see below).
4. **History across evenings:** done (v3: evening summary, list of past evenings, all-time leaders). Next: use results to nudge levels, and sync the history between organizers.
5. **Shared roster for two organizers** without a backend: re-import a backup link to merge changes. A real sync (Supabase) only if they actually need it.

---

# v3: groups, login and sync

## What was built
- **Groups:** each group (the neighbourhood, the base, the office) has its own roster, settings and evening.
  - Switch, create, rename and delete from the group name in the top bar.
  - Existing data becomes the first group, "הקבוצה שלי", on the first run after the update.
- **Optional login:** Google, a one-time email code (the magic link in the same email works too), or email + password.
  - The account area is in Settings.
  - Without logging in, everything works as before, and the Supabase library isn't loaded at all.
- **Sync between organizers' phones (Supabase):**
  - "סנכרון בין טלפונים" uploads a group; "הזמנת מארגן" shares a `#join=` link valid for 14 days.
  - Opening the link asks you to log in, then adds the group to the phone.
  - Three-way merge with versioned, conditional pushes; realtime updates from other phones.
  - Offline edits are pushed when back online; a status dot sits next to the group name.
- **Server:** tables `groups`, `group_members`, `group_invites`, each with RLS, plus RPCs `create_group`, `create_invite`, `join_group`, `leave_group`.
  - Applied to project `cieyeoyuwddobrxjcffw` (migrations in `supabase/migrations/`). The security advisor shows no findings.

## What was tested
- **`npm test`: 91 tests pass**, 34 of them new:
  - Storage migration from `kochot:v1` and repair of a damaged index.
  - Group index edits.
  - The three-way merge: players, pairs, settings, history; edit vs delete; concurrent adds.
  - Sync rounds against a fake server: pull-only, push, two offline phones, a lost version race and retry, rename, gone, network error.
- **`npm run e2e`** (all earlier steps, plus):
  - Create a second group and switch back.
  - Upgrade from the old single key.
  - No requests to Supabase while logged out.
  - The backup-link step now stubs `navigator.share`, because newer headless Chrome exposes a share sheet that never resolves.
- **`npm run screenshots`:** adds the groups sheet and the new-group sheet. Login sheets were also captured in light and dark, at 390 px.
- **Against the real Supabase project**, with two throwaway confirmed users created by SQL and deleted afterwards:
  - Phone A logs in with email + password from the UI, uploads a group, and creates an invite.
  - Phone B opens the link, logs in and joins (14 players).
  - B adds a player, and A receives it via realtime.
  - A goes offline and adds a player while B adds another. Back online, both phones have all 17.
  - Theme and attendance were not uploaded.
- **RLS was checked in SQL** with two simulated users:
  - A non-member sees 0 groups, members and invites, and updates 0 rows.
  - The member sees the group after joining; a stale version updates 0 rows; leaving removes access.
  - `anon` gets "permission denied" for tables and RPCs.

## Not verified
- **Real email delivery** (the code/magic-link email and signup confirmation), and Google login, which isn't configured yet.
- **Login on a real phone over the LAN IP.** Plain http there means PKCE falls back to the "plain" method, which Supabase supports.

## Next steps
1. **Configure the Supabase dashboard:** Site URL, redirect URLs, the Google provider, and the email template with `{{ .Token }}` (step by step: `docs/SETUP-HOSTING-AND-LOGIN.md`).
2. **A custom SMTP server** before real use: the built-in email sender is heavily rate-limited on the free plan.
3. **"Players" role:** read-only access to teams and stats without ratings (needs a view or a separate doc without ratings).
4. ~~**Revoke invite links from the UI;** show the group's organizers.~~ Done in v6 (groups sheet → "מארגנים והזמנות"; see DECISIONS "Organizers and invite links (v6)"). Not built: removing another organizer.
5. **Host on Vercel with the user's domain:** `vercel.json` and service-worker versioning are ready; the user follows `docs/SETUP-HOSTING-AND-LOGIN.md` (Vercel, domain, Supabase URLs, email template + Resend SMTP, Google). Verified locally only (no Vercel account yet).
6. **(Future idea from the user, not built) Anonymous post-game ratings via WhatsApp:** after an evening, a logged-in group sends a link where players rate anonymously how each teammate played; results could nudge levels. Needs: a random anonymous token per evening (in the link, with an expiry), a Supabase table for votes + an RPC that accepts votes only for that evening's players, abuse limits (one vote per device/token, rate limits, ignore outliers), and a privacy note (votes are anonymous; only aggregates reach the organizers).

# v4: positions and the player profile

## What was built
- **Player form (quick add and edit):** level → "איפה הוא חזק?" (🧤 שוער, 🛡️ הגנה, 🔄 קישור, ⚡ התקפה; 🧤 is the old `canGK`, now one control in both keeper modes) → folded "עוד על השחקן" with the 12 cards → folded inside it "דירוג מפורט מתקדם" (sliders).
- **Balancing:** a position-spread term (weight 0.15, beyond what's unavoidable) so defenders/midfielders/attackers spread across teams; borrowing and swap suggestions see it too. With rotating keepers a 🧤 player starts in goal (v7: no longer; random).
- **Display:** tiny position emojis in the roster and import preview; a compact `🛡️2 🔄1 ⚡2` line per team on the teams screen.
- **Import:** position words in pasted lists/CSV; the template has an `עמדות` column.

## What was tested
- Engine: stacked vs spread split of equal strength, odd counts free when as even as possible, ½ per position for two-position players, exact regression without positions, 3-team spread, borrowing picks the missing position. State: sanitizing/migration, emojis, backup, import words and the template, keeper order in rotate mode. Sync: positions survive the server round-trip and a remote edit merges.
- e2e: quick add with positions and a keeper, roster emojis, the edit sheet's folds and a position edit, imported positions, the team line. Screenshots `03a`–`03c` (light + dark).

## Not verified
- Mixed versions during sync (see DECISIONS v4): a phone on the previous version that edits a player drops his positions.

# v5: penalties

- A level match can be decided on penalties ("מי ניצחה בפנדלים?", optional shoot-out score); the winner stays, the loser is queued. Counts as a win/loss everywhere, never as goals (DECISIONS → Penalties (v5)).
- Tested: unit (queue rotation, standings/streak/dominance, 2 teams, sanitize garbage and old records, history stats/all-time/merge); e2e step 7c (0–0 → pens 3–2 → winner stays, loser at the back, summary and match list show it); screenshots `11a`/`11b` and `13b` (light + dark).
# v5: multi-delete, swipe tip, fold arrows
- **Built:** select mode on the players list with one confirmation and one `deletePlayers` reducer action; a one-time swipe tip with a nudge of the first row; the swiped row keeps the name in place; fold chevrons fixed (a nested fold was flipped by its open parent).
- **Tested:** reducer (several players at once: teams cancelled, pairs and attendance cleaned, the evening archived once; players outside the teams keep them; a deleted sub cancels them). e2e: mouse-drag swipe (name stays put), tip dismiss survives reload, select mode (tap selects, no swipe, count, confirmation lists names, deletes, leaves select mode, select all + cancel), nested fold chevrons differ. Screenshots `03-players-tip`, `03e`/`03f` folds, `03g` select mode, `03h` multi confirm, `05c` teams fold open, `11b` settings fold open (light + dark).

# v6: add to home screen
- **Built:** from the second use (opened again 12+ h after the first use began), a card at the top of the main screen: "התקנה" via Chrome's prompt, or illustrated Safari steps on iPhone/iPad (open in Safari first in Instagram/Facebook…); "אחר כך" (a week) / "לא להציג שוב"; never while a match clock runs or when already installed. Settings → "התקנה במסך הבית" keeps the steps. Manifest `id`, 180 px apple-touch-icon, status-bar meta (DECISIONS → Add to home screen (v6)).
- **Tested:** unit (`src/state/install.test.ts`: use counting, the show rule, dismissals, junk flags, iPhone/iPad/in-app/Chrome-iOS/Android detection); e2e step 16 (not on the first use, shown on the second, iPhone steps + share icon, above the main button, "later" remembered and back after the week, hidden while the clock runs, "never" remembered, Settings steps, Instagram → open in Safari, standalone never, Android prompt one tap → installed). Screenshots `16a`–`16d` (light + dark).
- **Not verified:** on real phones (Safari's menu wording in Hebrew, iOS 26 layout, Chrome's real prompt).

# v6: left early
- **Built:** "עזב באמצע" (teams screen) / "מישהו עזב?" (match screen): pick → confirm → he's off his team, the bench, the keeper rotation, the borrow and today's attendance, without reshuffling; then the best sub is offered, or (no subs) up to 2 swaps that never touch a match under way. A tiny short team outside goes to the bench; nobody goes below 2. Not flagged as stale. See DECISIONS → Left early (v6).
- **Tested:** 17 unit tests (`src/state/leave.test.ts`); e2e step 11b (sample squad, a match, 2 late arrivals, one leaves → sub suggestion accepted, not stale, attendance and history right, the evening continues, a second leave from the match screen); screenshots `16a`–`16f` (light + dark).

# v7: animal cards, "good in goal"
- **Built:** cards are clear animals/symbols: strengths 🦍 גורילה, 🐆 צ'יטה, 🎯 מדויק, 🪄 קוסם, 🧠 מוח, ⭐ כוכב; weaknesses 🫏 חמור, 🦥 עצלן, 🐢, 😮‍💨, 🙅, 🥶, 🌱. Stored ids kept; 🧱 dropped (→ 🛡️ position); untouched ratings follow the new deltas. 🧤 is "טוב בשער"; rotating keepers are random again. See DECISIONS → Animal cards and "good in goal" (v7).
- **Tested:** unit (set balance, deltas, opposites, migration of old ratings / hand-tuned / rock, idempotence, old and new import words, keeper order both modes); e2e (new card and chip names, an old stored player with `rock` + `captain` loads as ⭐ only); screenshots `03a`/`03b`/`03` (light + dark).
- **Open:** Settings fixed-keeper hint still says ״שוער קבוע״ (owned by the settings rework).

# v7: help screen
- **Built:** `#help` "שאלות ותשובות": a "?" in the main top bar, a row at the top of Settings, a "?" next to the balance score (opens that question). Folded questions in four sections, a search box, and an icon legend generated from the cards and positions (DECISIONS → Help screen (v7)). Content in `src/ui/help.ts`.
- **Tested:** `src/ui/help.test.ts` (legend = every card and position, unique ids, search); e2e help step (top bar → question opens → legend has every card/position chip from the add form → search → Settings row and back → score "?" opens #help/score → back to the teams); screenshots `02c`–`02g` (light + dark).

# v8: QA pass
- **Fixed:** the roster link removed from Settings (fold "גיבוי"; old `#import=` links still open); the backup file restore keeps the rules between players; the teams-screen re-split asks first during an evening; the new game day also starts when the app returns to the screen; singular Hebrew for one player. Details in DECISIONS → "QA pass (v8)". Tested: unit (`restoreBackup`), e2e (file restore, old link, re-split question, new day without reload, singular strings).
- **Known issues (found, not fixed):**
  1. **"הגרלה מחדש" during an evening** (teams screen, after a match) reshuffles the teams at once, without asking and without undo ("ביטול החלפות" can't bring them back). The standings keep counting by team number, so "קבוצה 1" is now other people. Nothing is lost (finished matches keep who played). Repro: make teams → play a match → teams → re-roll.
  2. **Ticking a late player at home during an evening** makes the teams screen offer "חלוקה מחדש" (now with a question) instead of pointing to "הגיע מאוחר". Left to the late-arrival rework.
  3. **"ביטול החלפות" doesn't undo a sub swap** (only swaps between teams). Repro: swap two players between teams, then tap a sub and a player → "ביטול החלפות" reverts the first swap but leaves the sub in (after a sub swap alone the link doesn't show).
  4. **Back while a sheet is open** (scorer, penalties, length) leaves the screen instead of closing the sheet; the goal/match stays as it was, nothing is lost.
  5. **Two groups can have the same name** ("בבסיס" twice).
  6. **The countdown rounds down:** it shows 7:59 right after "התחלה" and 0:00 for the last second before time-up. Cosmetic.
  7. Deleting a group says "השחקנים וההגדרות יימחקו" but its evenings history goes too.
