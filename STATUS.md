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
  - **Goal celebration:** "גוֹל!" burst with confetti in the bib colour, a synthesized crowd roar + air horn, and a Hebrew announcer (speechSynthesis). Sound setting (crowd + announcer / crowd / off) and a mute icon on the match screen.
  - "End the evening".
- **Players screen:**
  - Quick add: name, level 1–10 (with a one-line scale hint), up to 3 of 12 player cards in two rows (6 strengths, 6 weaknesses).
  - Optional "דירוג מפורט" (detailed rating) sliders, folded in quick add and open in the edit sheet.
  - **List import:** paste text or upload CSV/TXT/JSON, preview before adding, downloadable template (`docs/roster-template.csv`).
- **Settings:**
  - Rotating vs. fixed keepers, and switch every 1/2/3 goals.
  - Match length and bib colours (which you own, in order).
  - Look: light, dark or follow the phone, and a main colour (green, blue, purple, orange, pink).
  - Keep-apart / keep-together pairs.
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
- **First visit needs a connection:** the service worker caches on first use, so if the very first visit is offline, nothing is cached yet. Also, iOS only stops evicting local data once the app is added to the home screen; the app doesn't prompt for that yet.
- **Swap suggestions aren't browser-tested:** the "teams filled" suggestion and the dominance hint are unit-tested, but the browser flow doesn't trigger them.
- **History is per phone:** past evenings (results, scorers, who played) are saved on the phone that ran the match and in the backup *file*, not in the backup link. Who was borrowed from the losing team isn't recorded, so borrowers' wins aren't counted.
- **No way to mark someone as left:** you untick them at home, which flags the teams as out of date.
- **Fixed design limits:** the main screen offers 3–7 per team (larger sizes aren't reachable), there are 8 bib colours, and cards are a fixed list (12).
- **The backup link can get long** for very large rosters (it's roughly 1–2 KB for 25 players, which is fine for WhatsApp).

- **Proposal, not built (changes balancing, so it needs the user's OK):** when the plan has a short team, pick the split from the near-optimal candidates (within +0.05) by how even the match is with the best borrower from each possible loser. In a simulation this raised the worst case from ~85 to ~88, at a cost of ~0.015 rating points in the split itself.

## Next steps, most valuable first
1. **Try it at a real game** on 2–3 phones (iOS and Android): share, wake lock, install, offline. Then fix what hurts.
2. **"Add to home screen" prompt** after the second use, so iOS keeps the data.
3. **"Left early" button** on the teams and match screens: remove a player and suggest one swap.
4. **History across evenings:** done (v3: evening summary, list of past evenings, all-time leaders). Next: use results to nudge levels, and sync the history between organizers.
5. **Shared roster for two organizers** without a backend: re-import a backup link to merge changes. A real sync (Supabase) only if they actually need it.
