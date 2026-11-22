import { describe, expect, it } from 'vitest';
import { effectiveLevel, eveningMean, formOf, formText, sanitizeForm, withForm } from './form';
import { DEFAULT_SETTINGS, sanitizePlayer, type Player } from './model';
import { applyCards } from './cards';
import { prepareSplit, teamTotals } from './splitCore';
import { mergeDocs, sanitizeDoc, type SyncDoc } from '../sync/doc';

const P = (id: string, extra: Record<string, unknown> = {}): Player =>
  sanitizePlayer({ id, name: id.toUpperCase(), attrs: applyCards(5, []), canGK: false, cards: [], ...extra })!;
const doc = (players: Player[]): SyncDoc => sanitizeDoc({ v: 1, players });

describe('form math (v37)', () => {
  it('an evening counts with 2+ votes; "לא יודע" is no vote', () => {
    expect(eveningMean([1])).toBeNull();
    expect(eveningMean([1, 0])).toBe(0.5);
    expect(eveningMean([-1, -1, 1])).toBeCloseTo(-1 / 3);
    expect(eveningMean([1, 2 as never, 1])).toBe(1);
  });

  it('0.3 × mean, older evenings fade by 0.85, clamped to ±1.5', () => {
    expect(formOf([])).toBe(0);
    expect(formOf([1])).toBe(0.3);
    expect(formOf([1, 1])).toBe(0.56); // 0.3 + 0.255
    expect(formOf([-1, 1])).toBe(-0.05);
    expect(formOf(Array(40).fill(1))).toBe(1.5);
    expect(formOf(Array(40).fill(-1))).toBe(-1.5);
  });

  it('three reviewers on one evening: +1, +1, 0 → +0.2', () => {
    expect(formOf([eveningMean([1, 1, 0])!])).toBe(0.2);
  });
});

describe('form on the player', () => {
  it('sanitize: finite, ±1.5, 2 decimals, none for 0', () => {
    expect(P('a', { form: 0.333 }).form).toBe(0.33);
    expect(P('a', { form: 9 }).form).toBe(1.5);
    expect(P('a', { form: -9 }).form).toBe(-1.5);
    for (const bad of [0, NaN, Infinity, '0.3', null]) expect('form' in P('a', { form: bad })).toBe(false);
    expect(sanitizeForm(-0.004)).toBeUndefined();
  });

  it('effective level = level + form, 1–10', () => {
    expect(effectiveLevel(P('a', { form: 0.3 }))).toBeCloseTo(5.3);
    expect(effectiveLevel({ attrs: { overall: 10 }, form: 1 })).toBe(10);
    expect(effectiveLevel({ attrs: { overall: 1 }, form: -1 })).toBe(1);
    expect(effectiveLevel(P('a'))).toBe(5);
  });

  it('withForm moves every attribute (clamped), same object without form', () => {
    const p = P('a');
    expect(withForm(p)).toBe(p);
    const q = withForm(P('b', { form: 1.2, attrs: { ...applyCards(5, []), shooting: 9.5 } }));
    expect(q.attrs.overall).toBeCloseTo(6.2);
    expect(q.attrs.shooting).toBe(10);
  });

  it('the split and the team totals use level + form', () => {
    const players = [P('a', { form: 1.5 }), P('b'), P('c'), P('d', { form: -1 })];
    const prep = prepareSplit({ players, presentIds: players.map((p) => p.id), teamSize: 2, settings: DEFAULT_SETTINGS, constraints: { together: [], apart: [] } }, 1)!;
    expect(prep.req.players.find((p) => p.id === 'a')!.attrs.overall).toBe(6.5);
    expect(prep.req.players.find((p) => p.id === 'd')!.attrs.overall).toBe(4);
    expect(teamTotals(['a', 'b', 'c', 'd'], [0, 0, 1, 1], 2, players, DEFAULT_SETTINGS.weights)).toEqual([12, 9]);
  });

  it('organizer merges keep the server\'s form; a phone without it never wipes it', () => {
    const base = doc([P('a', { form: 0.3 })]);
    const local = doc([P('a', { name: 'Avi' })]);
    const remote = doc([P('a', { form: 0.5 })]);
    const m = mergeDocs(base, local, remote).players[0];
    expect(m.name).toBe('Avi');
    expect(m.form).toBe(0.5);
    expect('form' in mergeDocs(base, doc([P('a', { form: 0.3 })]), doc([P('a')])).players[0]).toBe(false);
  });

  it('edit sheet text', () => {
    expect(formText(undefined)).toBe('');
    expect(formText(0.04)).toBe('');
    expect(formText(0.26)).toBe('+0.3');
    expect(formText(-0.2)).toBe('-0.2');
  });
});
