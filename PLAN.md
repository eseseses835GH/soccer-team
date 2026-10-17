# PLAN — "כוחות" (Kochot): balanced pickup-football teams

## Goal
A mobile-first, Hebrew/RTL, no-backend web app: enter friends once with ratings, tick who
showed up, get fair teams in one tap, tweak, re-roll, share to WhatsApp.

## Stack
- **Vite + React + TypeScript**: small, fast, static output (`dist/`).
- **Vitest** for unit tests of the pure engine.
- No UI library. Hand-written CSS with custom properties (light/dark via `prefers-color-scheme`),
  logical properties (`margin-inline-start` etc.) for RTL.
- Persistence: `localStorage` behind a tiny safe wrapper (try/catch, schema version).
- Web Worker for the balancing search (Vite's `new Worker(new URL(...), { type: 'module' })`),
  with a synchronous fallback if workers are unavailable.

## Folder structure
```
src/
  engine/              # pure, framework-free; no DOM, no React
    types.ts           # Player, Attributes, Weights, Constraints, Solution
    rng.ts             # seeded PRNG (mulberry32)
    sizes.ts           # team-size computation
    cost.ts            # cost function + per-team totals + balance score
    search.ts          # exhaustive + local search, top-N, re-roll sampling
    index.ts           # public API: balanceTeams(), evaluate()
    *.test.ts          # Vitest
  worker/balance.worker.ts
  state/
    storage.ts         # safe localStorage
    store.ts           # React context + reducer, persisted
    sample.ts          # demo squad
  ui/
    App.tsx, components/*, screens/{Players,Game,Teams,Settings}.tsx
  share.ts             # WhatsApp text, navigator.share / wa.me / clipboard
  i18n.ts              # Hebrew strings
  styles.css
```

## Data model
```ts
type AttrKey = 'overall'|'stamina'|'coordination'|'teamwork'|'leadership'
             |'shooting'|'dribbling'|'goalkeeping';
interface Player { id: string; name: string; attrs: Record<AttrKey, number>; canGK: boolean; quick?: boolean }
interface Settings { weights: Record<AttrKey, number>; leadershipThreshold: number; penalties: {...} }
interface Constraints { together: [id,id][]; apart: [id,id][] }
interface AppState { version: 1; players; presentIds; numTeams; settings; constraints; lastResult? }
```

## Algorithm
- Player vector = weighted attributes. Team sum vector per team.
- **Balance cost** = Σ_attr w_attr · (max_team_sum − min_team_sum)/ (n_players_per_team·10) — normalized
  so that it is comparable across group sizes. (Spread over teams; for 2 teams this is |A−B|.)
- **Penalties** (added to cost, large enough to dominate small balance gains):
  - size mismatch beyond target sizes (hard: search only generates valid sizes; penalty is a guard),
  - goalkeepers: if #canGK ≥ #teams, each team without a GK is penalized; GK count spread otherwise,
  - leadership: if #leaders(≥threshold) ≥ #teams, each team without a leader is penalized,
  - keep-together pair split / keep-apart pair joined: very large penalty (soft-hard).
- **Search**:
  - 2 teams and n ≤ 14: exhaustive enumeration of all subsets of the right size containing player 0
    (fixing player 0 halves the space; C(13,6)=1716 for 14). Keep top-N.
  - otherwise: randomized greedy start (snake draft by weighted strength with random noise)
    + swap/move hill-climbing, many restarts until a time budget (~250ms) or restart cap.
    Keep a deduplicated top-N pool (canonicalized partitions).
- **Re-roll**: sample from top-N solutions whose cost ≤ best·(1+ε)+δ, excluding the current one,
  with seeded RNG. Seeded RNG ⇒ deterministic tests.
- **Balance score** shown to users: 0–100, `100 · exp(−k·cost)`.

## Milestones (commit after each)
1. Engine + tests.
2. Data/state (storage, store, sample squad).
3. UI screens: players, game setup, teams (swap), settings (weights, constraints).
4. Sharing (WhatsApp text, navigator.share, wa.me, clipboard).
5. Polish: dark mode, empty states, validation, Playwright visual check @390px, README, STATUS.
