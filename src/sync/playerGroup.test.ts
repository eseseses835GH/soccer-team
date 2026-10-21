import { describe, expect, it } from 'vitest';
import { loadIndex, newGroupState, type KV } from '../state/groups';
import type { EveningRecord } from '../state/history';
import type { LiveData, LiveRow } from './live';
import {
  LIVE_STALE_MS,
  claimChoices,
  clockText,
  isPlayerGroup,
  joinPlan,
  liveName,
  liveNow,
  loadPublic,
  publicKey,
  publicToState,
  rateCard,
  runsOrganizerSync,
  surveyList,
  surveyStart,
} from './playerGroup';
import type { PublicGroup } from './players';

function memKV(init: Record<string, unknown> = {}) {
  const m = new Map<string, string>(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  const kv: KV = {
    get: (k) => (m.has(k) ? JSON.parse(m.get(k)!) : null),
    set: (k, v) => (m.set(k, JSON.stringify(v)), true),
    remove: (k) => void m.delete(k),
  };
  return kv;
}

const NOW = 1_800_000_000_000;
const roster = [
  { id: 'a', name: 'אבי' },
  { id: 'b', name: 'בני' },
  { id: 'c', name: 'גיל' },
  { id: 'd', name: 'דני' },
];
const pub = (me: Partial<PublicGroup['me']> = {}, claimed: string[] = []): PublicGroup => ({
  groupId: 'g1',
  name: 'שכונה',
  players: roster,
  history: [],
  claimed,
  me: { role: 'player', playerId: null, canRate: false, ...me },
  updatedAt: '',
});
const liveData: LiveData = { v: 1, at: NOW, teamSize: 2, players: [{ id: 'a', name: 'אבי (הערב)' }], teams: [{ bib: 'red', ids: ['a', 'b'], keeper: 'a' }], subs: [], match: null };
const row = (updatedAt: string, data = liveData): LiveRow => ({ data, updatedBy: null, byName: 'אלי', updatedAt });

describe('role branching', () => {
  it('a player group never runs the organizer sync; organizer groups do; local groups don’t', () => {
    expect(runsOrganizerSync({ synced: true, role: 'player' })).toBe(false);
    expect(runsOrganizerSync({ synced: true })).toBe(true);
    expect(runsOrganizerSync({ synced: false })).toBe(false);
    expect(runsOrganizerSync(undefined)).toBe(false);
    expect(isPlayerGroup({ role: 'player' })).toBe(true);
    expect(isPlayerGroup({})).toBe(false);
  });

  it('the groups index keeps the player role and drops anything else', () => {
    const kv = memKV({
      'kochot:groups': {
        v: 1,
        currentId: 'p',
        groups: [
          { id: 'o', name: 'שלי', synced: true, createdAt: 1 },
          { id: 'p', name: 'שכונה', synced: true, createdAt: 2, role: 'player' },
          { id: 'x', name: 'מוזר', synced: true, createdAt: 3, role: 'admin' },
          { id: 'y', name: 'מארגן', synced: true, createdAt: 4, role: 'organizer' },
        ],
      },
    });
    const idx = loadIndex(kv, NOW);
    expect(idx.groups.map((g) => g.role)).toEqual([undefined, 'player', undefined, 'organizer']);
    expect(idx.groups.map(runsOrganizerSync)).toEqual([true, false, true, true]);
    expect('role' in idx.groups[0]).toBe(false);
  });

  it('join plan: player link → player group; an organizer group known here is never kept as organizer for a player', () => {
    expect(joinPlan(undefined, 'player')).toBe('player-new');
    expect(joinPlan({ role: 'player' }, 'player')).toBe('player-open');
    expect(joinPlan({}, 'player')).toBe('player-new');
    expect(joinPlan(undefined, 'organizer')).toBe('organizer-fresh');
    expect(joinPlan({}, 'organizer')).toBe('organizer-open');
    // A player who got an organizer link: start from the server's copy, nothing of the public copy.
    expect(joinPlan({ role: 'player' }, 'organizer')).toBe('organizer-fresh');
  });
});

describe('public copy on the phone', () => {
  it('becomes names-only state with the history, no teams or match', () => {
    const history = [{ id: 'e1', v: 1, startedAt: 1, endedAt: 2, teamSize: 2, subIds: [], players: roster, teams: [], matches: [] }] as unknown as EveningRecord[];
    const s = publicToState({ ...newGroupState({ theme: 'dark', accent: 'blue' }), presentIds: ['zz'] }, { ...pub(), history });
    expect(s.players.map((p) => p.name)).toEqual(['אבי', 'בני', 'גיל', 'דני']);
    expect(s.players.every((p) => p.levelVotes === undefined && p.cards.length === 0)).toBe(true);
    expect(s.history).toBe(history);
    expect(s.presentIds).toEqual([]);
    expect(s.result).toBeNull();
    expect(s.settings.theme).toBe('dark');
  });

  it('is cached per group and read back', () => {
    const kv = memKV();
    expect(loadPublic(kv, 'g1')).toBeNull();
    kv.set(publicKey('g1'), pub({ playerId: 'a', canRate: true }, ['a']));
    expect(loadPublic(kv, 'g1')?.me).toEqual({ role: 'player', playerId: 'a', canRate: true });
  });
});

describe('who are you', () => {
  it('free names first (A–Z), taken ones after; my own claim isn’t "taken"', () => {
    expect(claimChoices(pub({}, ['b'])).map((p) => [p.id, p.taken])).toEqual([
      ['a', false],
      ['c', false],
      ['d', false],
      ['b', true],
    ]);
    expect(claimChoices(pub({ playerId: 'b' }, ['b'])).find((p) => p.id === 'b')?.taken).toBe(false);
  });
});

describe('rating survey', () => {
  it('never includes me', () => {
    expect(surveyList(pub({ playerId: 'b', canRate: true })).map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });

  it('resumes at the first one not rated; skipped ones come back; all done → start over', () => {
    const list = surveyList(pub({ playerId: 'b', canRate: true }));
    expect(surveyStart(list, {})).toBe(0);
    expect(surveyStart(list, { a: 7 })).toBe(1);
    expect(surveyStart(list, { a: 7, d: 5 })).toBe(1); // c was skipped
    expect(surveyStart(list, { a: 7, c: 4, d: 5 })).toBe(0);
  });

  it('home card: none without permission, claim first, then rate / update', () => {
    expect(rateCard(null, {})).toBe('none');
    expect(rateCard(pub(), {})).toBe('none');
    expect(rateCard(pub({ canRate: true }), {})).toBe('claim');
    expect(rateCard(pub({ canRate: true, playerId: 'a' }), {})).toBe('rate');
    expect(rateCard(pub({ canRate: true, playerId: 'a' }), { b: 6 })).toBe('update');
    expect(rateCard(pub({ canRate: true, playerId: 'a', role: 'organizer' }), {})).toBe('none');
  });
});

describe('live evening', () => {
  it('nothing published or ended → none', () => {
    expect(liveNow(null, NOW)).toBeNull();
  });

  it('shows a fresh row; a row older than 12 h is yesterday → none', () => {
    expect(liveNow(row(new Date(NOW - 60_000).toISOString()), NOW)).toBe(liveData);
    expect(liveNow(row(new Date(NOW - LIVE_STALE_MS + 1000).toISOString()), NOW)).toBe(liveData);
    expect(liveNow(row(new Date(NOW - LIVE_STALE_MS - 1000).toISOString()), NOW)).toBeNull();
  });

  it('falls back to the publisher’s time when updated_at is missing', () => {
    expect(liveNow(row(''), NOW + 1000)).toBe(liveData);
    expect(liveNow(row('', { ...liveData, at: NOW - LIVE_STALE_MS - 1 }), NOW)).toBeNull();
    expect(liveNow(row('', { ...liveData, at: 0 }), NOW)).toBeNull();
  });

  it('names: tonight’s first, then the roster, then ?', () => {
    expect(liveName(liveData, roster, 'a')).toBe('אבי (הערב)');
    expect(liveName(liveData, roster, 'c')).toBe('גיל');
    expect(liveName(liveData, roster, 'zz')).toBe('?');
  });

  it('clock text', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(247_900)).toBe('4:07');
    expect(clockText(-61_000)).toBe('1:01');
  });
});
