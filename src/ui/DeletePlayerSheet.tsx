import type { Player } from '../state/model';
import { useGroups, useStore } from '../state/store';
import { Sheet } from './components';

/**
 * "Are you sure?" before deleting a player, from a swipe or from the edit sheet.
 * Says what else goes with him (today's teams, pairs) and, in a synced group,
 * that the other organizers lose him too.
 */
export function DeletePlayerSheet({ player, onCancel, onConfirm }: { player: Player; onCancel: () => void; onConfirm: () => void }) {
  const { state } = useStore();
  const { current } = useGroups();
  const id = player.id;
  const inTeams = !!state.result && (state.result.playerIds.includes(id) || state.result.subIds.includes(id));
  const played = inTeams && !!state.match?.history.length;
  const hasPairs = [...state.constraints.together, ...state.constraints.apart].some((p) => p[0] === id || p[1] === id);

  const notes: string[] = [];
  if (inTeams) notes.push(played ? 'הוא בכוחות של היום, אז הכוחות יתבטלו. המשחקים ששוחקו נשמרים בהיסטוריה.' : 'הוא בכוחות של היום, אז הכוחות יתבטלו וצריך לעשות כוחות מחדש.');
  if (hasPairs) notes.push('גם הזוגות שלו (ביחד / בנפרד) יימחקו.');
  if (current.synced) notes.push('הקבוצה מסונכרנת, אז הוא יימחק גם אצל המארגנים האחרים.');

  return (
    <Sheet title={`למחוק את ${player.name}?`} onClose={onCancel}>
      <div className="confirm-delete">
        <p className="lead">הוא יוסר מרשימת השחקנים. ערבים קודמים בהיסטוריה לא משתנים.</p>
        {notes.length > 0 && (
          <ul className="confirm-notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="stack">
          <button type="button" className="btn btn-danger btn-block" onClick={onConfirm}>
            מחיקה
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </Sheet>
  );
}
