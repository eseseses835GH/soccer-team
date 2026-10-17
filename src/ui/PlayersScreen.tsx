import { useRef, useState } from 'react';
import { ATTR_KEYS, type Player } from '../engine';
import { ATTR_LABELS, playersCount } from '../i18n';
import { defaultAttrs, newId } from '../state/model';
import { useStore } from '../state/store';
import { useUi } from './App';
import { EmptyState, RatingSlider, Sheet, TapRating, Toggle } from './components';
import { Icon } from './icons';

const MAX_NAME = 24;

export function PlayersScreen() {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [name, setName] = useState('');
  const [overall, setOverall] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Player | 'new' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const nameTaken = (n: string, exceptId?: string) =>
    state.players.some((p) => p.id !== exceptId && p.name.trim() === n.trim());

  const quickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('צריך שם');
    if (nameTaken(n)) return setError('כבר יש שחקן בשם הזה');
    dispatch({ type: 'addPlayer', player: { id: newId(), name: n, attrs: defaultAttrs(overall), canGK: false }, present: true });
    notify(`${n} נוסף`);
    setName('');
    setOverall(5);
    setError(null);
    nameRef.current?.focus();
  };

  const sorted = [...state.players].sort((a, b) => a.name.localeCompare(b.name, 'he'));

  return (
    <section aria-labelledby="players-h">
      <div className="section-head">
        <h2 id="players-h">שחקנים</h2>
        <span className="muted">{playersCount(state.players.length)}</span>
      </div>

      <form className="card quick-add" onSubmit={quickAdd} noValidate>
        <h3>הוספה מהירה</h3>
        <div className="row">
          <label className="sr-only" htmlFor="qa-name">
            שם השחקן
          </label>
          <input
            id="qa-name"
            ref={nameRef}
            className="input"
            placeholder="שם השחקן"
            value={name}
            maxLength={MAX_NAME}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={!!error}
            aria-describedby={error ? 'qa-err' : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          <button type="submit" className="btn btn-primary">
            <Icon name="plus" size={20} />
            הוספה
          </button>
        </div>
        {error && (
          <p id="qa-err" className="field-error">
            {error}
          </p>
        )}
        <div className="field-label">רמה כללית</div>
        <TapRating label="רמה כללית" value={overall} onChange={setOverall} />
        <button type="button" className="link-btn" onClick={() => setEditing('new')}>
          הוספה עם כל התכונות ←
        </button>
      </form>

      {state.players.length === 0 ? (
        <EmptyState icon="👟" title="עוד אין שחקנים">
          <p>מוסיפים כל חבר פעם אחת, ומאז רק מסמנים מי הגיע.</p>
          <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'loadSample' })}>
            טעינת סגל לדוגמה
          </button>
        </EmptyState>
      ) : (
        <ul className="player-list">
          {sorted.map((p) => (
            <li key={p.id}>
              <button type="button" className="player-row" onClick={() => setEditing(p)}>
                <span className="rating-badge" aria-label={`רמה ${p.attrs.overall}`}>
                  {p.attrs.overall}
                </span>
                <span className="player-name">{p.name}</span>
                <span className="chips">
                  {p.canGK && <span className="chip" title="יכול לשחק בשער">🧤 שוער</span>}
                  {p.attrs.leadership >= state.settings.leadershipThreshold && (
                    <span className="chip" title="מנהיג">©️ מנהיג</span>
                  )}
                </span>
                <span className="chev" aria-hidden="true">
                  ‹
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <PlayerForm
          player={editing === 'new' ? null : editing}
          nameTaken={nameTaken}
          onClose={() => setEditing(null)}
          onSave={(p, isNew) => {
            dispatch(isNew ? { type: 'addPlayer', player: p, present: true } : { type: 'updatePlayer', player: p });
            notify(isNew ? `${p.name} נוסף` : 'נשמר');
            setEditing(null);
          }}
          onDelete={(p) => {
            dispatch({ type: 'deletePlayer', id: p.id });
            notify(`${p.name} נמחק`);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function PlayerForm({
  player,
  nameTaken,
  onClose,
  onSave,
  onDelete,
}: {
  player: Player | null;
  nameTaken: (n: string, exceptId?: string) => boolean;
  onClose: () => void;
  onSave: (p: Player, isNew: boolean) => void;
  onDelete: (p: Player) => void;
}) {
  const [draft, setDraft] = useState<Player>(() => player ?? { id: newId(), name: '', attrs: defaultAttrs(), canGK: false });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = draft.name.trim();
    if (!n) return setError('צריך שם');
    if (nameTaken(n, draft.id)) return setError('כבר יש שחקן בשם הזה');
    onSave({ ...draft, name: n }, !player);
  };

  return (
    <Sheet title={player ? `עריכת ${player.name}` : 'שחקן חדש'} onClose={onClose}>
      <form className="player-form" onSubmit={save} noValidate>
        <label className="field-label" htmlFor="pf-name">
          שם
        </label>
        <input
          id="pf-name"
          className="input"
          value={draft.name}
          maxLength={MAX_NAME}
          autoComplete="off"
          aria-invalid={!!error}
          onChange={(e) => {
            setDraft({ ...draft, name: e.target.value });
            setError(null);
          }}
        />
        {error && <p className="field-error">{error}</p>}
        <div className="sliders">
          {ATTR_KEYS.map((k) => (
            <RatingSlider
              key={k}
              label={ATTR_LABELS[k]}
              value={draft.attrs[k]}
              onChange={(v) => setDraft({ ...draft, attrs: { ...draft.attrs, [k]: v } })}
            />
          ))}
        </div>
        <Toggle checked={draft.canGK} onChange={(v) => setDraft({ ...draft, canGK: v })} label="יכול לשחק בשער 🧤" />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-block">
            שמירה
          </button>
          {player &&
            (confirmDelete ? (
              <button type="button" className="btn btn-danger btn-block" onClick={() => onDelete(player)}>
                בטוח? מחיקה סופית
              </button>
            ) : (
              <button type="button" className="btn btn-ghost-danger btn-block" onClick={() => setConfirmDelete(true)}>
                מחיקת שחקן
              </button>
            ))}
        </div>
      </form>
    </Sheet>
  );
}
