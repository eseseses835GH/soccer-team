// Fair keepers after a shuffle (DECISIONS → "Keepers after a shuffle (v38)"): whoever already stood in
// goal tonight goes after those who haven't, fewest turns first; "לא בשער" stays last.
import { keeperIndex, rotation } from '../match/match';

/** One part of tonight (one team set): keeper orders, the matches played, the keeper shifts at the end. */
export interface KeeperPart {
  orders: string[][];
  matches: readonly { a: number; b: number; goals: readonly { team: number }[] }[];
  shifts?: readonly number[];
}

/**
 * How many turns in goal each player had: per team, the keeper is
 * rotation[(floor(conceded / every) + shift) mod len]. A keeper counts once per stint when his team
 * starts a match with him, or he comes in after a goal and the match goes on (a later goal).
 * The shift is the part's last one (the records don't keep its history).
 */
export function keeperTurns(parts: readonly KeeperPart[], every: number, noGK?: ReadonlySet<string>): Map<string, number> {
  const turns = new Map<string, number>();
  const add = (id: string) => turns.set(id, (turns.get(id) ?? 0) + 1);
  for (const part of parts) {
    part.orders.forEach((order, t) => {
      const r = rotation(order, noGK);
      if (!r.length) return;
      const shift = part.shifts?.[t] ?? 0;
      const at = (c: number) => r[keeperIndex(c, every, r.length, shift)];
      let conceded = 0;
      let last = -1;
      const stint = () => Math.floor(conceded / Math.max(1, every));
      for (const m of part.matches) {
        if (m.a !== t && m.b !== t) continue;
        if (stint() !== last) {
          last = stint();
          add(at(conceded));
        }
        m.goals.forEach((g, i) => {
          if (g.team === t) return;
          conceded++;
          if (i < m.goals.length - 1 && stint() !== last) {
            last = stint();
            add(at(conceded));
          }
        });
      }
    });
  }
  return turns;
}

/**
 * Each team's keeper order with those who haven't kept goal yet first, then fewest turns first (the
 * order is kept among equals); "לא בשער" last (a team of only "לא בשער" rotates everyone).
 */
export function fairKeeperOrders(orders: readonly string[][], turns: ReadonlyMap<string, number>, noGK?: ReadonlySet<string>): string[][] {
  return orders.map((order) => {
    const keep = order.filter((id) => !noGK?.has(id));
    const pool = keep.length ? keep : [...order];
    const rest = keep.length ? order.filter((id) => noGK?.has(id)) : [];
    const n = (id: string) => turns.get(id) ?? 0;
    return [...pool.map((id, i) => ({ id, i })).sort((x, y) => n(x.id) - n(y.id) || x.i - y.i).map((x) => x.id), ...rest];
  });
}
