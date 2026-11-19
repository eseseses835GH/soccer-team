/** The evening summary for the group chat (names only, never levels). */
import { buildEveningShareText } from '../share';
import { bestLineup, championOf, leaders, nameIn, nightScorers, teamTable, teamsChanged, type EveningRecord, type TeamRow } from './history';
import { bibLook, verb } from './model';

const lookOf = (rec: EveningRecord, t: number) => bibLook(rec.teams[t]?.bib, t);
const record = (r: TeamRow) => `${r.won} נ׳${r.pensWon ? ` (${r.pensWon} בפנדלים)` : ''} · ${r.drawn} ת׳ · ${r.lost} ה׳`;
const roster = (rec: EveningRecord, t: number) => (rec.teams[t]?.ids ?? []).map((id) => nameIn(rec, id));

/** "א, ב וג". */
const joinNames = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} ו${list[list.length - 1]}` : (list[0] ?? ''));

/**
 * Each team with its record and who played in it. `night` = the night's records, oldest first.
 * Teams the same all night: `rec` alone, its clear winner "took the evening", plus `highlights`.
 * Teams changed (a shuffle, a latecomer): every part, the lineup with the clearly best record
 * took the evening (if one stands out), plus the night's top scorers.
 */
export function eveningShareText(night: EveningRecord[], rec: EveningRecord, highlights: string[]): string {
  const changed = teamsChanged(night);
  const recs = changed ? night : [rec];
  const parts = recs.map((r, i) => ({
    title: i > 0 ? '🔀 אחרי שאפל' : undefined,
    teams: teamTable(r).map((row) => ({ line: `${lookOf(r, row.team).emoji} ${lookOf(r, row.team).name}: ${record(row)}`, names: roster(r, row.team) })),
  }));
  if (!changed) {
    const champ = championOf(teamTable(rec));
    const look = champ ? lookOf(rec, champ.team) : null;
    return buildEveningShareText({
      date: new Date(rec.startedAt),
      champion: look ? `${look.emoji} ${look.the} ${verb(look, 'לקחו', 'לקחה')} את הערב` : undefined,
      parts,
      highlights,
    });
  }
  const best = bestLineup(night);
  const kings = leaders(nightScorers(night));
  return buildEveningShareText({
    date: new Date(recs[0].startedAt),
    champion: best
      ? `ההרכב שלקח את הערב: ${lookOf(best.rec, best.row.team).emoji} ${roster(best.rec, best.row.team).join(', ')} (${record(best.row)})`
      : undefined,
    parts,
    highlights: kings.length ? [`👑 ${kings.length > 1 ? 'מלכי השערים' : 'מלך השערים'}: ${joinNames(kings.map((k) => k.name))} (${kings[0].n})`] : [],
  });
}
