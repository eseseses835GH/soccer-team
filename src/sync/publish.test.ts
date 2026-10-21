import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCards } from '../state/cards';
import { INITIAL_STATE, defaultAttrs, type AppState, type Player } from '../state/model';
import type { LiveData } from './live';
import { eveningEnded, justEnded, playerMemberRows, withPlayerVotes } from './organizer';
import { eveningId } from '../state/history';
import type { GameResult } from '../state/model';
import type { MatchState } from '../match/match';
import { parseMembers, type VoteRow } from './players';
import { createLivePublisher, liveKey, shouldRepublish } from './publish';
import { SyncError } from './supabase';

const live = (score: number, at = 1): LiveData => ({
  v: 1,
  at,
  teamSize: 5,
  players: [{ id: 'a', name: 'A' }],
  teams: [
    { bib: 'red', ids: ['a'], keeper: 'a' },
    { bib: 'blue', ids: [], keeper: null },
  ],
  subs: [],
  match: {
    n: 1,
    onPitch: [0, 1],
    queue: [],
    score: [score, 0],
    goals: [],
    clock: { running: false, startedAt: null, elapsedMs: 0, lengthMs: null },
    extra: false,
    borrow: null,
    streak: [0, 0],
    played: [],
  },
});

describe('live publisher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (online = { v: true }) => {
    const sent: [string, LiveData | null][] = [];
    const send = vi.fn(async (g: string, l: LiveData | null) => void sent.push([g, l]));
    const onSent = vi.fn();
    const pub = createLivePublisher({ send, onSent, isOnline: () => online.v, now: () => 999, delay: 1000, retryMs: 5000 });
    return { pub, sent, send, onSent, online };
  };

  it('debounces: a burst of changes sends only the latest, stamped with the send time', async () => {
    const { pub, sent } = setup();
    pub.update('g', live(1));
    pub.update('g', live(2));
    await vi.advanceTimersByTimeAsync(500);
    pub.update('g', live(3));
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([['g', { ...live(3), at: 999 }]]);
  });

  it("doesn't resend an unchanged snapshot (publish time ignored), but republish forces it", async () => {
    const { pub, send } = setup();
    pub.baseline('g', live(1, 5));
    pub.update('g', live(1, 77));
    await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled();
    pub.republish('g', live(1));
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
    expect(liveKey(live(1, 1))).toBe(liveKey(live(1, 2)));
  });

  it('ended = null, sent once', async () => {
    const { pub, sent, onSent } = setup();
    pub.update('g', live(1));
    await vi.runAllTimersAsync();
    pub.update('g', null);
    pub.update('g', null);
    await vi.runAllTimersAsync();
    pub.update('g', null);
    await vi.runAllTimersAsync();
    expect(sent.map((s) => s[1] && s[1].match?.score[0])).toEqual([1, null]);
    expect(onSent).toHaveBeenLastCalledWith('g', null);
  });

  it('offline: queues only the latest and sends it when back online', async () => {
    const { pub, sent, online } = setup({ v: false });
    pub.update('g', live(1));
    await vi.runAllTimersAsync();
    pub.update('g', live(2));
    pub.update('g', null);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
    expect([...pub.pending()]).toEqual([['g', null]]);
    online.v = true;
    await pub.flush();
    expect(sent).toEqual([['g', null]]);
    expect(pub.pending().size).toBe(0);
  });

  it('a network failure keeps it queued; a refusal drops it', async () => {
    const { pub, send } = setup();
    send.mockRejectedValueOnce(new SyncError('x', 'offline'));
    pub.update('g', live(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(pub.pending().size).toBe(1);
    await pub.flush();
    expect(pub.pending().size).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);

    send.mockRejectedValueOnce(new Error('500'));
    pub.update('g', live(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(pub.pending().size).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); // retried later on its own
    expect(pub.pending().size).toBe(0);

    send.mockRejectedValueOnce(new SyncError('x', 'denied'));
    pub.update('g', live(3));
    await vi.advanceTimersByTimeAsync(1000);
    expect(pub.pending().size).toBe(0);
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('v12: someone else runs it → dropped (no retry) and reported', async () => {
    const send = vi.fn(async () => {
      throw new SyncError('someone else runs the evening', 'conflict');
    });
    const conflicts: string[] = [];
    const pub = createLivePublisher({ send, isOnline: () => true, retryMs: 5000, onConflict: (g) => conflicts.push(g) });
    pub.update('g', live(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(pub.pending().size).toBe(0);
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
    expect(conflicts).toEqual(['g']);
  });

  it('a change during a send goes out right after it', async () => {
    let release!: () => void;
    const sent: number[] = [];
    const pub = createLivePublisher({
      send: (_g, l) => {
        sent.push(l?.match?.score[0] ?? -1);
        return sent.length === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
      },
      isOnline: () => true,
      delay: 0,
    });
    pub.update('g', live(1));
    await vi.advanceTimersByTimeAsync(0);
    pub.update('g', live(2));
    const f = pub.flush();
    release();
    await f;
    await vi.runAllTimersAsync();
    expect(sent).toEqual([1, 2]);
  });

  it("doesn't take over another organizer's fresh evening on open", () => {
    const now = Date.parse('2026-10-21T20:00:00Z');
    expect(shouldRepublish(null, 'me', now)).toBe(true);
    expect(shouldRepublish({ updatedBy: 'ME', updatedAt: '2026-10-21T19:59:00Z' }, 'me', now)).toBe(true);
    expect(shouldRepublish({ updatedBy: 'other', updatedAt: '2026-10-21T19:55:00Z' }, 'me', now)).toBe(false);
    expect(shouldRepublish({ updatedBy: 'other', updatedAt: '2026-10-21T19:40:00Z' }, 'me', now)).toBe(true);
  });
});

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const U3 = '00000000-0000-4000-8000-000000000003';
const pl = (id: string, level: number, votes?: Record<string, number>): Player => ({
  id,
  name: id,
  attrs: applyCards(level, []),
  canGK: false,
  cards: [],
  ...(votes ? { levelVotes: votes } : {}),
});

describe('players votes → levels', () => {
  const state = (players: Player[]): AppState => ({ ...INITIAL_STATE, players });
  const rows: VoteRow[] = [
    { rater: U2, playerId: 'p1', level: 9 },
    { rater: U3, playerId: 'p1', level: 8 },
    { rater: U2, playerId: 'p2', level: 4 },
  ];

  it('sets the level to the average of organizers and permitted players', () => {
    const s = state([pl('p1', 5, { [U1]: 5 }), pl('p2', 6), pl('p3', 3)]);
    const out = withPlayerVotes(s, rows);
    expect(out.players.map((p) => p.attrs.overall)).toEqual([7, 4, 3]); // (5+9+8)/3 = 7.33; p2 only a player's vote
    expect(out.players[0].levelVotes).toEqual({ [U1]: 5 }); // players' votes stay out of the doc
    expect(out.players[2]).toBe(s.players[2]);
  });

  it('is idempotent: applying again returns the very same state (no push loop)', () => {
    const once = withPlayerVotes(state([pl('p1', 5, { [U1]: 5 }), pl('p2', 6)]), rows);
    expect(withPlayerVotes(once, rows)).toBe(once);
    const none = state([pl('p1', 5)]);
    expect(withPlayerVotes(none, [])).toBe(none);
  });

  it('hand-tuned sliders keep their tuning', () => {
    const tuned = { ...pl('p1', 5), attrs: { ...defaultAttrs(5), shooting: 9 } };
    const out = withPlayerVotes(state([tuned]), rows).players[0];
    expect(out.attrs.overall).toBe(9); // (9+8)/2 = 8.5 → 9
    expect(out.attrs.shooting).toBe(9);
  });
});

describe('players who joined → rows', () => {
  const members = parseMembers([
    { user_id: 'o', display_name: 'Dana', role: 'organizer', joined_at: '2026-10-01T00:00:00Z', is_me: true },
    { user_id: 'b', display_name: 'Moshe', role: 'player', player_id: 'p2', can_rate: true, joined_at: '2026-10-03T00:00:00Z' },
    { user_id: 'a', display_name: '', role: 'player', player_id: null, can_rate: false, joined_at: '2026-10-02T00:00:00Z' },
    { user_id: 'c', display_name: 'Gone', role: 'player', player_id: 'deleted', can_rate: false, joined_at: '2026-10-04T00:00:00Z' },
  ]);
  const roster = [
    { id: 'p1', name: 'יוסי' },
    { id: 'p2', name: 'משה כהן' },
  ];

  it('players only, oldest first, with what they claimed', () => {
    expect(playerMemberRows(members, roster)).toEqual([
      { userId: 'a', name: 'שחקן/ית', claimed: null, canUnclaim: false, canRate: false },
      { userId: 'b', name: 'Moshe', claimed: 'משה כהן', canUnclaim: true, canRate: true },
      { userId: 'c', name: 'Gone', claimed: null, canUnclaim: true, canRate: false },
    ]);
  });

  it('empty when only organizers (the section is hidden)', () => {
    expect(playerMemberRows(members.filter((m) => m.role === 'organizer'), roster)).toEqual([]);
    expect(playerMemberRows(parseMembers(null), roster)).toEqual([]);
  });
});

describe('end of the evening → nothing live', () => {
  const r = { createdAt: 5, playerIds: ['a', 'b'], subIds: [] } as unknown as GameResult;
  const m = {} as MatchState;
  it('the match going away with the same teams is "סיום הערב"', () => {
    expect(justEnded({ result: r, match: m }, { result: r, match: null })).toBe(true);
    expect(justEnded({ result: r, match: m }, { result: { ...r }, match: null })).toBe(false); // new teams
    expect(justEnded({ result: r, match: null }, { result: r, match: null })).toBe(false);
  });
  it('ended when saved in the history or remembered; a new match makes it live again', () => {
    expect(eveningEnded({ result: r, match: null, history: [] }, null)).toBe(false); // teams made, no match yet
    expect(eveningEnded({ result: r, match: null, history: [] }, eveningId(r))).toBe(true);
    expect(eveningEnded({ result: r, match: null, history: [{ id: eveningId(r) } as never] }, null)).toBe(true);
    expect(eveningEnded({ result: r, match: m, history: [{ id: eveningId(r) } as never] }, null)).toBe(false);
    expect(eveningEnded({ result: null, match: null, history: [] }, null)).toBe(false);
  });
});
