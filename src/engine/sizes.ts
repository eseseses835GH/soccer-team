/**
 * Team sizes for `n` players split into `k` teams: as equal as possible,
 * sizes differ by at most 1, larger teams first. 10/2 -> [5,5], 11/2 -> [6,5].
 */
export function teamSizes(n: number, k: number): number[] {
  if (k < 1) throw new Error('need at least one team');
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Human format string, e.g. "5 נגד 5" / "6 נגד 5" / "4 נגד 4 נגד 4". */
export function formatLabel(sizes: number[]): string {
  return sizes.join(' נגד ');
}

/** Minimum players: each team needs at least `minPerTeam`. */
export function canSplit(n: number, k: number, minPerTeam = 2): boolean {
  return k >= 2 && n >= k * minPerTeam;
}
