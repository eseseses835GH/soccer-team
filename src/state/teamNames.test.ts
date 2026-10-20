import { describe, expect, it } from 'vitest';
import { startSession } from '../match/match';
import { makeBackup, parseBackup } from './io';
import { DEFAULT_SETTINGS, INITIAL_STATE, bibLook, defaultAttrs, sanitizeSettings, teamBibs, teamLook, verb, type AppState, type GameResult, type Player, type Settings } from './model';
import { reducer } from './reducer';
import { sanitizeHistory } from './history';

const withBibs = (bibs: Settings['bibs'] = ['red', 'blue', 'yellow']): Settings => ({ ...DEFAULT_SETTINGS, hasBibs: true, bibs });
const noBibs: Settings = { ...DEFAULT_SETTINGS, hasBibs: false };

describe('team names', () => {
  it('without bibs: "קבוצה N", singular, each with its own colour', () => {
    const l = teamLook(noBibs, 0);
    expect(l).toMatchObject({ name: 'קבוצה 1', the: 'קבוצה 1', to: 'לקבוצה 1', from: 'מקבוצה 1', in: 'בקבוצה 1', plural: false });
    expect(`${l.the} ${verb(l, 'ניצחו', 'ניצחה')}`).toBe('קבוצה 1 ניצחה');
    const c3 = teamLook(noBibs, 2);
    const c2 = teamLook(noBibs, 1);
    expect(`משלימים את ${c3.the} ${c2.from}`).toBe('משלימים את קבוצה 3 מקבוצה 2');
    expect(`${c3.the} ${verb(c3, 'יוצאים', 'יוצאת')}`).toBe('קבוצה 3 יוצאת');
    const colours = Array.from({ length: 8 }, (_, t) => teamLook(noBibs, t).color);
    expect(new Set(colours).size).toBe(8);
    expect(colours.every((c) => c.startsWith('var(--bib-'))).toBe(true);
  });

  it('with bibs: plural bib names with the article', () => {
    const s = withBibs();
    const red = teamLook(s, 0);
    expect(red).toMatchObject({ name: 'אדומים', the: 'האדומים', to: 'לאדומים', from: 'מהאדומים', in: 'באדומים', plural: true, emoji: '🔴' });
    expect(`${red.the} ${verb(red, 'ניצחו', 'ניצחה')}`).toBe('האדומים ניצחו');
    expect(`משלימים את ${teamLook(s, 2).the} ${teamLook(s, 1).from}`).toBe('משלימים את הצהובים מהכחולים');
    // More teams than bibs: numbered by position.
    expect(teamLook(s, 3).the).toBe('קבוצה 4');
  });

  it('stored ids: bib colours, n1… and old records', () => {
    expect(teamBibs(noBibs, 3)).toEqual(['n1', 'n2', 'n3']);
    expect(teamBibs(withBibs(['red', 'blue']), 3)).toEqual(['red', 'blue', 'n3']);
    expect(bibLook('n2', 0).name).toBe('קבוצה 2');
    expect(bibLook('blue', 0).the).toBe('הכחולים');
    expect(bibLook('', 2).name).toBe('קבוצה 3');
    expect(bibLook(undefined, 0).name).toBe('קבוצה 1');
    expect(bibLook('nonsense', 1).name).toBe('קבוצה 2');
  });
});

describe('bibs setting migration (v7)', () => {
  it('defaults to no bibs', () => {
    expect(DEFAULT_SETTINGS.hasBibs).toBe(false);
    expect(sanitizeSettings(undefined).hasBibs).toBe(false);
  });

  it('keeps bibs on for groups that picked their colours, off for the untouched default', () => {
    expect(sanitizeSettings({ bibs: DEFAULT_SETTINGS.bibs }).hasBibs).toBe(false);
    expect(sanitizeSettings({ bibs: ['red', 'blue'] }).hasBibs).toBe(true);
    // Same colours, other order: a choice too.
    expect(sanitizeSettings({ bibs: [...DEFAULT_SETTINGS.bibs].reverse() }).hasBibs).toBe(true);
    // Garbage → default list → off.
    expect(sanitizeSettings({ bibs: ['pink'] })).toMatchObject({ hasBibs: false, bibs: DEFAULT_SETTINGS.bibs });
  });

  it('an explicit flag wins and survives a backup', () => {
    expect(sanitizeSettings({ hasBibs: true }).hasBibs).toBe(true);
    expect(sanitizeSettings({ hasBibs: false, bibs: ['red', 'blue'] })).toMatchObject({ hasBibs: false, bibs: ['red', 'blue'] });
    expect(sanitizeSettings({ hasBibs: 'yes' }).hasBibs).toBe(false);
    const b = parseBackup(JSON.parse(JSON.stringify(makeBackup([], { together: [], apart: [] }, withBibs(["green", "white"])))));
    expect(b?.settings).toMatchObject({ hasBibs: true, bibs: ['green', 'white'] });
  });
});

describe('history with numbered teams', () => {
  const p = (id: string): Player => ({ id, name: `P${id}`, attrs: defaultAttrs(5), canGK: false, cards: [] });
  const players = ['a', 'b', 'c', 'd'].map(p);
  const r: GameResult = {
    playerIds: ['a', 'b', 'c', 'd'],
    subIds: [],
    teamSize: 2,
    numTeams: 2,
    sizes: [2, 2],
    assignment: [0, 0, 1, 1],
    generated: [0, 0, 1, 1],
    pool: [],
    shown: [],
    gkOrder: [['a', 'b'], ['c', 'd']],
    createdAt: 1,
  };
  const state = (settings: Settings): AppState => ({ ...INITIAL_STATE, settings, players, presentIds: ['a', 'b', 'c', 'd'], dayAt: 1, result: r, match: startSession(2) });
  const ended = (s: AppState) => {
    const m = { ...s.match!, goals: [{ team: 0, at: 5 }] };
    return reducer({ ...s, match: m }, { type: 'endEvening', id: 'ev', now: 100 }).history[0];
  };

  it('stores n1/n2 without bibs and bib ids with bibs', () => {
    expect(ended(state(noBibs)).teams.map((t) => t.bib)).toEqual(['n1', 'n2']);
    expect(ended(state(withBibs(['blue', 'red']))).teams.map((t) => t.bib)).toEqual(['blue', 'red']);
  });

  it('reads back both kinds after sanitizing', () => {
    const [rec] = sanitizeHistory([JSON.parse(JSON.stringify(ended(state(noBibs))))]);
    expect(rec.teams.map((t, i) => bibLook(t.bib, i).name)).toEqual(['קבוצה 1', 'קבוצה 2']);
  });
});
