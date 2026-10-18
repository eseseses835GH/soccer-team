import { useRef, useState } from 'react';
import { ATTR_KEYS } from '../engine';
import { ATTR_LABELS, playersCount } from '../i18n';
import { applyCards, toggleCard, type CardId } from '../state/cards';
import { ROSTER_TEMPLATE, parseBackup, parseRoster, type ParsedRoster } from '../state/io';
import { newId, type Player } from '../state/model';
import { useStore } from '../state/store';
import { downloadText } from '../share';
import { useUi } from './App';
import { CardBadges, CardPicker, LevelPicker, RatingSlider, Sheet, Toggle } from './components';
import { Icon } from './icons';

const MAX_NAME = 24;

export function PlayersScreen() {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [cards, setCards] = useState<CardId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Player | null>(null);
  const [importing, setImporting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const nameTaken = (n: string, exceptId?: string) => state.players.some((p) => p.id !== exceptId && p.name.trim() === n.trim());

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('צריך שם');
    if (nameTaken(n)) return setError('כבר יש שחקן בשם הזה. אפשר להוסיף כינוי, למשל "דני ג׳"');
    dispatch({ type: 'addPlayer', player: { id: newId(), name: n, attrs: applyCards(level, cards), canGK: false, cards }, present: true });
    notify(`${n} נוסף ומסומן שהגיע`);
    setName('');
    setLevel(5);
    setCards([]);
    setError(null);
    nameRef.current?.focus();
  };

  const sorted = [...state.players].sort((a, b) => a.name.localeCompare(b.name, 'he'));

  return (
    <section className="players" aria-label="השחקנים">
      <form className="add" onSubmit={add} noValidate>
        <label className="label" htmlFor="add-name">
          שחקן חדש
        </label>
        <input
          id="add-name"
          ref={nameRef}
          className="input input-big"
          placeholder="איך קוראים לו?"
          value={name}
          maxLength={MAX_NAME}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={!!error}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error && <p className="field-error">{error}</p>}
        <span className="label">רמה</span>
        <LevelPicker value={level} onChange={setLevel} />
        <span className="label">
          איזה שחקן הוא? <small>לא חובה · עד 2</small>
        </span>
        <CardPicker value={cards} onToggle={(id) => setCards((c) => toggleCard(c, id))} />
        <button type="submit" className="btn btn-primary btn-block">
          <Icon name="plus" size={20} /> הוספה
        </button>
      </form>

      <div className="section-title">
        <h2>{playersCount(state.players.length)}</h2>
        <button type="button" className="text-btn" onClick={() => setImporting(true)}>
          <Icon name="upload" size={18} /> ייבוא רשימה
        </button>
      </div>

      {state.players.length === 0 ? (
        <div className="empty small">
          <p>יש לכם רשימה בוואטסאפ או באקסל? מדביקים אותה ב״ייבוא רשימה״, וכולם נכנסים בבת אחת.</p>
          <button type="button" className="btn btn-quiet" onClick={() => dispatch({ type: 'loadSample', now: Date.now() })}>
            סגל לדוגמה
          </button>
        </div>
      ) : (
        <ul className="roster">
          {sorted.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setEditing(p)}>
                <span className="name">{p.name}</span>
                <CardBadges cards={p.cards} />
                <span className="level" aria-label={`רמה ${p.attrs.overall}`}>
                  {p.attrs.overall}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <PlayerSheet
          player={editing}
          nameTaken={nameTaken}
          fixedKeepers={state.settings.gkMode === 'fixed'}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            dispatch({ type: 'updatePlayer', player: p });
            notify('נשמר');
            setEditing(null);
          }}
          onDelete={(p) => {
            dispatch({ type: 'deletePlayer', id: p.id });
            notify(`${p.name} נמחק`);
            setEditing(null);
          }}
        />
      )}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </section>
  );
}

function PlayerSheet({
  player,
  nameTaken,
  fixedKeepers,
  onClose,
  onSave,
  onDelete,
}: {
  player: Player;
  nameTaken: (n: string, exceptId?: string) => boolean;
  fixedKeepers: boolean;
  onClose: () => void;
  onSave: (p: Player) => void;
  onDelete: (p: Player) => void;
}) {
  const [draft, setDraft] = useState<Player>(player);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Level/cards rebuild the attributes; fine-tuning with sliders comes after.
  const setProfile = (level: number, cards: CardId[]) => setDraft((d) => ({ ...d, cards, attrs: applyCards(level, cards) }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = draft.name.trim();
    if (!n) return setError('צריך שם');
    if (nameTaken(n, draft.id)) return setError('כבר יש שחקן בשם הזה');
    onSave({ ...draft, name: n });
  };

  return (
    <Sheet title={player.name} onClose={onClose}>
      <form className="player-form" onSubmit={save} noValidate>
        <label className="label" htmlFor="pf-name">
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
        <span className="label">רמה</span>
        <LevelPicker value={draft.attrs.overall} onChange={(v) => setProfile(v, draft.cards)} />
        <span className="label">
          איזה שחקן הוא? <small>עד 2</small>
        </span>
        <CardPicker value={draft.cards} onToggle={(id) => setProfile(draft.attrs.overall, toggleCard(draft.cards, id))} />
        {fixedKeepers && <Toggle checked={draft.canGK} onChange={(v) => setDraft({ ...draft, canGK: v })} label="שוער קבוע" hint="יתחלק שוער אחד לכל קבוצה" />}
        <details className="fold">
          <summary>כיוון עדין</summary>
          <p className="hint small">שינוי רמה או כרטיסייה מחשב את זה מחדש.</p>
          <div className="sliders">
            {ATTR_KEYS.filter((k) => k !== 'overall').map((k) => (
              <RatingSlider key={k} label={ATTR_LABELS[k]} value={draft.attrs[k]} onChange={(v) => setDraft({ ...draft, attrs: { ...draft.attrs, [k]: v } })} />
            ))}
          </div>
        </details>
        <div className="stack">
          <button type="submit" className="btn btn-primary btn-block">
            שמירה
          </button>
          {confirmDelete ? (
            <button type="button" className="btn btn-danger btn-block" onClick={() => onDelete(player)}>
              בטוח? מחיקה סופית
            </button>
          ) : (
            <button type="button" className="btn btn-quiet danger btn-block" onClick={() => setConfirmDelete(true)}>
              מחיקה
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed: ParsedRoster = parseRoster(text, state.players.map((p) => p.name));

  const commit = (players: Player[]) => {
    for (const p of players) dispatch({ type: 'addPlayer', player: p });
    notify(`נוספו ${players.length} שחקנים`);
    onClose();
  };

  const onFile = async (file: File) => {
    try {
      const content = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const b = parseBackup(JSON.parse(content));
        if (!b) return notify('הקובץ לא נראה כמו גיבוי של כוחות');
        const taken = new Set(state.players.map((p) => p.name.trim()));
        commit(b.players.filter((p) => !taken.has(p.name.trim())).map((p) => ({ ...p, id: newId() })));
        return;
      }
      setText(content.replace(/^﻿/, ''));
    } catch {
      notify('לא הצלחתי לקרוא את הקובץ');
    }
  };

  return (
    <Sheet title="ייבוא רשימה" onClose={onClose}>
      <p className="lead">שחקן בכל שורה: שם, ואחריו רמה (לא חובה). אפשר להוסיף ״שוער״ או שם של כרטיסייה.</p>
      <pre className="example" dir="rtl">{'אבי 8\nדני הקטן, 6, שוער\nנועם, 7, הקוסם\nיוסי'}</pre>
      <textarea className="input textarea" rows={6} placeholder="מדביקים כאן…" value={text} onChange={(e) => setText(e.target.value)} aria-label="רשימת שחקנים" />
      <div className="row-links">
        <button type="button" className="text-btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> מקובץ (CSV / טקסט / גיבוי)
        </button>
        <button type="button" className="text-btn" onClick={() => downloadText('kochot-roster-template.csv', ROSTER_TEMPLATE, 'text/csv')}>
          <Icon name="download" size={18} /> קובץ תבנית
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.json,text/csv,text/plain,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {text.trim() && (
        <div className="preview">
          <p>
            <strong>{parsed.players.length}</strong> שחקנים מוכנים
            {parsed.skipped.length > 0 && `, ${parsed.skipped.length} דולגו`}
          </p>
          {parsed.skipped.length > 0 && (
            <ul className="skipped">
              {parsed.skipped.slice(0, 5).map((s, i) => (
                <li key={i}>
                  {s.line}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <ul className="preview-list">
            {parsed.players.slice(0, 30).map((p) => (
              <li key={p.id}>
                {p.name} <span className="muted">{p.attrs.overall}</span> <CardBadges cards={p.cards} />
                {p.canGK && ' 🧤'}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" disabled={!parsed.players.length} onClick={() => commit(parsed.players)}>
        הוספת {parsed.players.length || ''} שחקנים
      </button>
    </Sheet>
  );
}
