// v21: the same login on another phone (my_groups → what to add here) and the organizer put in his
// own roster on the server (claim_self_as_organizer), kept by the organizer phone's three-way merge.
import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, defaultAttrs, sanitizePlayer, type Player } from '../state/model';
import { docFromState, type SyncDoc } from './doc';
import { EMPTY_META, syncGroup, type RemoteApi, type SyncMeta } from './engine';
import { adoptionPlan, parseMyGroups, selfClaimTargets, type MyGroup } from './myGroups';
import { sameName } from './playerGroup';

const p = (id: string, name = id): Player => ({ id, name, attrs: defaultAttrs(5), canGK: false, cards: [] });
const doc = (players: Player[]): SyncDoc => docFromState({ ...INITIAL_STATE, players });
const ids = (d: SyncDoc) => d.players.map((x) => x.id).sort();
const g = (id: string, role: MyGroup['role'] = 'organizer', playerId: string | null = null): MyGroup => ({ id, name: id, role, playerId });

describe('my_groups', () => {
  it('parses rows and drops junk', () => {
    expect(
      parseMyGroups([
        { group_id: 'a', name: ' כדורגל ', role: 'organizer', player_id: 'p1' },
        { group_id: 'b', name: '', role: 'player', player_id: null },
        { group_id: 5 },
        null,
        'x',
      ]),
    ).toEqual([
      { id: 'a', name: 'כדורגל', role: 'organizer', playerId: 'p1' },
      { id: 'b', name: 'קבוצה', role: 'player', playerId: null },
    ]);
    expect(parseMyGroups(null)).toEqual([]);
    expect(parseMyGroups({})).toEqual([]);
  });

  it('adds what this phone lacks, matched by id; never touches what it has', () => {
    const local = [
      { id: 'mine', synced: true },
      { id: 'local-only', synced: false },
      { id: 'pl', synced: true, role: 'player' as const },
      { id: 'left', synced: true },
    ];
    const plan = adoptionPlan(local, [g('mine'), g('local-only'), g('pl', 'player'), g('new-org'), g('new-pl', 'player')]);
    expect(plan.map((x) => [x.kind, x.group.id])).toEqual([
      ['organizer', 'new-org'],
      ['player', 'new-pl'],
    ]);
    // 'left' isn't listed any more: nothing happens to it here.
    expect(plan.some((x) => x.group.id === 'left')).toBe(false);
  });

  it('a player group here that I organize now is upgraded (made organizer on another phone)', () => {
    expect(adoptionPlan([{ id: 'pl', synced: true, role: 'player' }], [g('pl', 'organizer', 'p3')])).toEqual([{ kind: 'upgrade', group: g('pl', 'organizer', 'p3') }]);
    // Never the other way round, and never for a local group.
    expect(adoptionPlan([{ id: 'o', synced: true }], [g('o', 'player')])).toEqual([]);
    expect(adoptionPlan([{ id: 'pl', synced: false, role: 'player' }], [g('pl', 'organizer')])).toEqual([]);
  });

  it('self-claim in every group with no claim (players too), once per session', () => {
    const mine = [g('a'), g('b', 'organizer', 'p1'), g('c', 'player'), g('d', 'player', 'p2')];
    expect(selfClaimTargets(mine, new Set())).toEqual(['a', 'c']);
    expect(selfClaimTargets(mine, new Set(['a']))).toEqual(['c']);
  });
});

/** The groups row with the server's rules, and what claim_self_as_organizer does to it. */
function server(players: Player[]) {
  const s = {
    data: JSON.parse(JSON.stringify(doc(players))) as { players: Record<string, unknown>[] } & Record<string, unknown>,
    version: 1,
    claimed: new Set<string>(),
    beforePush: null as null | (() => void),
    /** Same JSON as the SQL: an unclaimed same name is claimed, otherwise a new default-level player. */
    claimSelf(name: string) {
      const hit = sameName(s.data.players.filter((x) => !s.claimed.has(x.id as string)) as { id: string; name: string }[], name);
      const id = hit?.id ?? 'self';
      if (!hit) {
        const attrs = { overall: 5, stamina: 5, passing: 5, dribbling: 5, shooting: 5, defense: 5, teamwork: 5, leadership: 5 };
        s.data = { ...s.data, players: [...s.data.players, { id, name, attrs, canGK: false, cards: [] }] };
        s.version++;
      }
      s.claimed.add(id);
      return id;
    },
  };
  const api: RemoteApi = {
    async fetchGroup() {
      return { id: 'g', name: 'ערב', data: JSON.parse(JSON.stringify(s.data)), version: s.version };
    },
    async pushGroup(_id, version, data) {
      const hook = s.beforePush;
      s.beforePush = null;
      hook?.();
      if (version !== s.version) return null;
      s.data = JSON.parse(JSON.stringify(data));
      s.version++;
      return s.version;
    },
  };
  return { s, api };
}

async function round(api: RemoteApi, local: SyncDoc, meta: SyncMeta) {
  const out = await syncGroup(api, 'g', local, 'ערב', meta);
  if (out.kind !== 'ok') throw new Error('gone');
  return out;
}

describe('the organizer added to his roster on the server', () => {
  it('the server-made player is exactly what the app keeps', () => {
    const { s } = server([]);
    s.claimSelf('אלי');
    expect(sanitizePlayer(s.data.players[0])).toEqual(s.data.players[0]);
  });

  it('an unclaimed same name is claimed, nothing added', () => {
    const { s } = server([p('a', 'אבי'), p('e', ' אלי ')]);
    expect(s.claimSelf('אלי')).toBe('e');
    expect(s.data.players).toHaveLength(2);
    expect(s.version).toBe(1);
  });

  it("his own phone (holding the roster, with offline edits) keeps the server's new player", async () => {
    const { s, api } = server([p('a'), p('b')]);
    let out = await round(api, doc([p('a'), p('b')]), EMPTY_META);
    // Offline: he adds c and deletes b. Meanwhile the server adds him.
    const local = doc([p('a'), p('c')]);
    s.claimSelf('אלי');
    out = await round(api, local, out.meta);
    expect(ids(out.doc)).toEqual(['a', 'c', 'self']);
    expect(ids(s.data as unknown as SyncDoc)).toEqual(['a', 'c', 'self']);
  });

  it('right after the upload (base = what he sent): the next pull brings him, no push', async () => {
    const sent = doc([p('a')]);
    const { s, api } = server([p('a')]);
    const meta: SyncMeta = { base: sent, baseVersion: 1, baseName: 'ערב' };
    s.claimSelf('אלי');
    const out = await round(api, sent, meta);
    expect(ids(out.doc)).toEqual(['a', 'self']);
    expect(out.pushed).toBe(false);
    expect(out.pulled).toBe(true);
  });

  it('a claim landing between his pull and his push: the push loses, re-merges, both kept', async () => {
    const { s, api } = server([p('a')]);
    let out = await round(api, doc([p('a')]), EMPTY_META);
    s.beforePush = () => s.claimSelf('אלי');
    out = await round(api, doc([p('a'), p('n')]), out.meta);
    expect(ids(out.doc)).toEqual(['a', 'n', 'self']);
    expect(ids(s.data as unknown as SyncDoc)).toEqual(['a', 'n', 'self']);
  });

  it('"השם שלי בקבוצה" on the server: the organizer phone takes the new name', async () => {
    const { s, api } = server([p('a', 'אבי'), p('m', 'test')]);
    let out = await round(api, doc([p('a', 'אבי'), p('m', 'test')]), EMPTY_META);
    s.data = { ...s.data, players: s.data.players.map((x) => (x.id === 'm' ? { ...x, name: 'טסט' } : x)) };
    s.version++;
    out = await round(api, out.doc, out.meta);
    expect(out.doc.players.find((x) => x.id === 'm')?.name).toBe('טסט');
  });

  it('"אני ברשימה בשם אחר": the automatic entry removed on the server goes from the organizer phone too', async () => {
    const { s, api } = server([p('y', 'יוסי'), p('auto', 'Yossi')]);
    let out = await round(api, doc([p('y', 'יוסי'), p('auto', 'Yossi')]), EMPTY_META);
    s.data = { ...s.data, players: s.data.players.filter((x) => x.id !== 'auto') };
    s.version++;
    out = await round(api, out.doc, out.meta);
    expect(ids(out.doc)).toEqual(['y']);
    // Had the organizer edited him meanwhile, the edit would win over the delete (v3 rule): kept.
    const again = server([p('y'), p('auto')]);
    let o2 = await round(again.api, doc([p('y'), p('auto')]), EMPTY_META);
    again.s.data = { ...again.s.data, players: again.s.data.players.filter((x) => x.id !== 'auto') };
    again.s.version++;
    o2 = await round(again.api, doc([p('y'), { ...p('auto'), name: 'יוסי כהן' }]), o2.meta);
    expect(ids(o2.doc)).toEqual(['auto', 'y']);
  });
});
