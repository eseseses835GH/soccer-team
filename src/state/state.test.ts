import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, defaultAttrs, sanitize } from './model';
import { reducer } from './reducer';

const p = (id: string) => ({ id, name: id, attrs: defaultAttrs(), canGK: false });

describe('sanitize', () => {
  it('returns defaults for garbage', () => {
    expect(sanitize(null)).toEqual(INITIAL_STATE);
    expect(sanitize('x')).toEqual(INITIAL_STATE);
  });
  it('repairs bad ratings and drops dangling references', () => {
    const s = sanitize({
      players: [{ id: 'a', name: 'A', attrs: { overall: 99 } }, { bad: true }],
      presentIds: ['a', 'zzz'],
      numTeams: 9,
      constraints: { together: [['a', 'zzz']], apart: [] },
      result: { playerIds: ['zzz'], assignment: [0] },
    });
    expect(s.players).toHaveLength(1);
    expect(s.players[0].attrs.overall).toBe(10);
    expect(s.players[0].attrs.shooting).toBe(5);
    expect(s.presentIds).toEqual(['a']);
    expect(s.numTeams).toBe(2);
    expect(s.constraints.together).toEqual([]);
    expect(s.result).toBeNull();
  });
});

describe('reducer', () => {
  it('deleting a player cleans attendance, constraints and results', () => {
    let s = reducer(INITIAL_STATE, { type: 'addPlayer', player: p('a'), present: true });
    s = reducer(s, { type: 'addPlayer', player: p('b'), present: true });
    s = reducer(s, { type: 'addConstraint', kind: 'together', pair: ['a', 'b'] });
    s = reducer(s, { type: 'setResult', playerIds: ['a', 'b'], numTeams: 2, best: { assignment: [0, 1], cost: 0 }, pool: [] });
    s = reducer(s, { type: 'deletePlayer', id: 'a' });
    expect(s.presentIds).toEqual(['b']);
    expect(s.constraints.together).toEqual([]);
    expect(s.result).toBeNull();
  });
  it('a pair cannot be both together and apart', () => {
    let s = reducer(INITIAL_STATE, { type: 'addConstraint', kind: 'together', pair: ['a', 'b'] });
    s = reducer(s, { type: 'addConstraint', kind: 'apart', pair: ['b', 'a'] });
    expect(s.constraints).toEqual({ together: [], apart: [['b', 'a']] });
  });
  it('swap and reset', () => {
    let s = reducer(INITIAL_STATE, { type: 'setResult', playerIds: ['a', 'b'], numTeams: 2, best: { assignment: [0, 1], cost: 0 }, pool: [] });
    s = reducer(s, { type: 'swap', i: 0, j: 1 });
    expect(s.result!.assignment).toEqual([1, 0]);
    s = reducer(s, { type: 'resetSwaps' });
    expect(s.result!.assignment).toEqual([0, 1]);
  });
  it('loading the sample squad keeps own players', () => {
    let s = reducer(INITIAL_STATE, { type: 'addPlayer', player: p('mine'), present: true });
    s = reducer(s, { type: 'loadSample' });
    s = reducer(s, { type: 'loadSample' });
    expect(s.players.filter((x) => x.id === 'mine')).toHaveLength(1);
    expect(s.players).toHaveLength(15);
    expect(s.presentIds).toContain('mine');
  });
});
