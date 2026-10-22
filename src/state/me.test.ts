import { describe, expect, it } from 'vitest';
import type { EveningRecord } from './history';
import { addStats, attended, eveningFor, initialOf, myPct, myStats, profileOf, recentEvenings } from './me';

const rec = (id: string, startedAt: number, matches: EveningRecord['matches'], extra: Partial<EveningRecord> = {}): EveningRecord => ({
  id,
  v: 1,
  startedAt,
  endedAt: startedAt + 1,
  teamSize: 2,
  players: ['a', 'b', 'c', 'd', 'e', 'f'].map((p) => ({ id: p, name: p.toUpperCase() })),
  teams: [
    { bib: 'red', ids: ['a', 'b'] },
    { bib: 'blue', ids: ['c', 'd'] },
    { bib: 'yellow', ids: ['e', 'f'] },
  ],
  subIds: [],
  matches,
  ...extra,
});
const m = (a: number, b: number, goalsA: number, goalsB: number, goals: { team: number; by?: string }[] = [], more: Partial<EveningRecord['matches'][number]> = {}) => ({ a, b, goalsA, goalsB, goals, endedAt: 1, ...more });

describe('profileOf', () => {
  it('Google: full name, picture, provider', () => {
    const p = profileOf({ email: 'dani@x.com', user_metadata: { full_name: 'Dani Levi', avatar_url: 'https://lh3.googleusercontent.com/a/x' }, app_metadata: { provider: 'google' } });
    expect(p).toEqual({ name: 'Dani Levi', email: 'dani@x.com', avatar: 'https://lh3.googleusercontent.com/a/x', google: true });
  });
  it('email login: the local part, no picture; picture key and providers list also read', () => {
    expect(profileOf({ email: 'eli.c@x.com', user_metadata: {}, app_metadata: { provider: 'email' } })).toEqual({ name: 'eli.c', email: 'eli.c@x.com', avatar: null, google: false });
    expect(profileOf({ email: 'a@x.com', user_metadata: { name: 'אבי', picture: 'https://p/x.png' }, app_metadata: { provider: 'email', providers: ['email', 'google'] } })).toMatchObject({ name: 'אבי', avatar: 'https://p/x.png', google: true });
  });
  it('no http or script pictures; null user', () => {
    expect(profileOf({ email: 'a@x.com', user_metadata: { avatar_url: 'javascript:alert(1)' } })?.avatar).toBeNull();
    expect(profileOf({ email: 'a@x.com', user_metadata: { avatar_url: 'http://p/x.png' } })?.avatar).toBeNull();
    expect(profileOf(null)).toBeNull();
  });
  it('initial', () => {
    expect(initialOf('dani')).toBe('D');
    expect(initialOf(' אלי')).toBe('א');
    expect(initialOf('')).toBe('?');
  });
});

describe('my stats', () => {
  it('counts matches by the side I was on, borrowed sides included', () => {
    // a is red. Match 2: red sat out but a was borrowed by blue (sides), and blue won.
    const r = rec('e1', 1, [
      m(0, 1, 2, 1, [{ team: 0, by: 'a' }, { team: 0, by: 'a' }, { team: 1, by: 'c' }]),
      m(1, 2, 1, 0, [{ team: 1, by: 'a' }], { sides: [['c', 'd', 'a'], ['e', 'f']] }),
      m(0, 2, 0, 1),
      m(0, 1, 1, 1),
      m(2, 1, 1, 1, [], { pens: { winner: 2 } }),
    ]);
    expect(eveningFor(r, 'a')).toEqual({ evenings: 1, played: 4, won: 2, drawn: 1, lost: 1, goals: 3 });
    // c: on blue's side in matches 1, 2, 4, 5 (lost on penalties).
    expect(eveningFor(r, 'c')).toEqual({ evenings: 1, played: 4, won: 1, drawn: 1, lost: 2, goals: 1 });
  });
  it('a penalty win is a win', () => {
    const r = rec('e1', 1, [m(0, 1, 1, 1, [], { pens: { winner: 0 } })]);
    expect(eveningFor(r, 'a')).toMatchObject({ played: 1, won: 1, drawn: 0 });
  });
  it('the bench counts as attended, not as played; absent is nothing', () => {
    const r = rec('e1', 1, [m(0, 1, 1, 0)], { subIds: ['z'] });
    expect(eveningFor(r, 'z')).toEqual({ evenings: 1, played: 0, won: 0, drawn: 0, lost: 0, goals: 0 });
    expect(attended(r, 'nobody')).toBe(false);
    expect(eveningFor(r, 'nobody').evenings).toBe(0);
  });
  it('goals only by scorer id (unnamed goals count for nobody)', () => {
    const r = rec('e1', 1, [m(0, 1, 2, 0, [{ team: 0 }, { team: 0, by: 'b' }])]);
    expect(eveningFor(r, 'a').goals).toBe(0);
    expect(eveningFor(r, 'b').goals).toBe(1);
  });
  it('over the history; win % from 5 matches only', () => {
    const h = [rec('e1', 1, [m(0, 1, 1, 0), m(0, 2, 1, 0)]), rec('e2', 2, [m(0, 1, 0, 1), m(0, 1, 2, 0)]), rec('e3', 3, [m(1, 2, 1, 0)])];
    const s = myStats(h, 'a');
    expect(s).toEqual({ evenings: 3, played: 4, won: 3, drawn: 0, lost: 1, goals: 0 });
    expect(myPct(s)).toBeNull();
    const more = addStats(s, myStats([rec('e4', 4, [m(0, 1, 0, 0)])], 'a'));
    expect(more.played).toBe(5);
    expect(myPct(more)).toBe(60);
  });
  it('recent evenings: played in, newest first, across groups, 3 at most', () => {
    const g1 = [rec('x1', 10, [m(0, 1, 1, 0)]), rec('x2', 30, [m(1, 2, 1, 0)]), rec('x3', 50, [m(0, 1, 0, 1)])];
    const g2 = [rec('y1', 40, [m(0, 1, 1, 0)]), rec('y2', 20, [m(0, 1, 1, 0)])];
    const got = recentEvenings([
      { groupId: 'g1', history: g1, playerId: 'a' },
      { groupId: 'g2', history: g2, playerId: 'a' },
    ]);
    // x2: a's team didn't play.
    expect(got.map((x) => x.rec.id)).toEqual(['x3', 'y1', 'y2']);
    expect(got[0]).toMatchObject({ groupId: 'g1', stats: { played: 1, lost: 1 } });
  });
});
