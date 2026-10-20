import type { Player } from '../state/model';
import { useGroups, useStore } from '../state/store';
import { Sheet } from './components';

/** How many names the multi-delete title lists before "ועוד N". */
const MAX_NAMES = 6;

/** "אבי, בני וגיל" or "אבי, בני, גיל ועוד 4". */
export function namesList(names: string[]): string {
  if (names.length <= MAX_NAMES) {
    if (names.length < 2) return names.join('');
    const last = names[names.length - 1];
    // "ו" sticks to a Hebrew name; before a Latin one a comma reads better.
    return `${names.slice(0, -1).join(', ')}${/^[\u0590-\u05FF]/.test(last) ? ' ו' : ', '}${last}`;
  }
  return `${names.slice(0, MAX_NAMES - 1).join(', ')} ועוד ${names.length - (MAX_NAMES - 1)}`;
}

/**
 * "Are you sure?" before deleting players, from a swipe, the edit sheet or select mode.
 * Says what else goes with them (today's teams, player rules) and, in a synced group,
 * that the other organizers lose them too.
 */
export function DeletePlayerSheet({ players, onCancel, onConfirm }: { players: Player[]; onCancel: () => void; onConfirm: () => void }) {
  const { state } = useStore();
  const { current } = useGroups();
  const ids = new Set(players.map((p) => p.id));
  const many = players.length > 1;
  const r = state.result;
  const inTeams = r ? players.filter((p) => r.playerIds.includes(p.id) || r.subIds.includes(p.id)) : [];
  const played = inTeams.length > 0 && !!state.match?.history.length;
  const hasPairs = [...state.constraints.together, ...state.constraints.apart].some((p) => ids.has(p[0]) || ids.has(p[1]));

  const notes: string[] = [];
  if (inTeams.length) {
    const who = !many ? 'הוא' : inTeams.length === 1 ? inTeams[0].name : inTeams.length === players.length ? 'הם' : 'חלק מהם';
    notes.push(`${who} בכוחות של היום, אז הכוחות יתבטלו${played ? '. המשחקים ששוחקו נשמרים בהיסטוריה.' : ' וצריך לעשות כוחות מחדש.'}`);
  }
  if (hasPairs) notes.push(many ? 'גם ההגדרות ״מי עם מי״ שלהם יימחקו.' : 'גם ההגדרות ״מי עם מי״ שלו יימחקו.');
  if (current.synced) notes.push(many ? 'הקבוצה מסונכרנת, אז הם יימחקו גם אצל המארגנים האחרים.' : 'הקבוצה מסונכרנת, אז הוא יימחק גם אצל המארגנים האחרים.');

  return (
    <Sheet title={many ? `למחוק ${players.length} שחקנים?` : `למחוק את ${players[0].name}?`} onClose={onCancel}>
      <div className="confirm-delete">
        {many && <p className="confirm-names">{namesList(players.map((p) => p.name))}</p>}
        <p className="lead">
          {many ? 'הם יוסרו' : 'הוא יוסר'} מרשימת השחקנים. ערבים קודמים בהיסטוריה לא משתנים.
        </p>
        {notes.length > 0 && (
          <ul className="confirm-notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="stack">
          <button type="button" className="btn btn-danger btn-block" onClick={onConfirm}>
            {many ? `מחיקת ${players.length} שחקנים` : 'מחיקה'}
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </Sheet>
  );
}
