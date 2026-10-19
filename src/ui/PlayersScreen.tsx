import { useRef, useState } from 'react';
import { ATTR_KEYS, type Attributes, type Position } from '../engine';
import { playersCount } from '../i18n';
import { MAX_CARDS, applyCards, toggleCard, type CardId } from '../state/cards';
import { ROSTER_TEMPLATE, parseBackup, parseRoster, type ParsedRoster } from '../state/io';
import { newId, type Player } from '../state/model';
import { withPositions } from '../state/positions';
import { useStore } from '../state/store';
import { downloadText } from '../share';
import { useUi } from './App';
import { AttrSliders, CardBadges, CardPicker, LevelPicker, PositionBadges, PositionPicker, Sheet } from './components';
import { DeletePlayerSheet } from './DeletePlayerSheet';
import { Icon } from './icons';
import { SwipeRow, closeSwipeRows } from './SwipeRow';

const MAX_NAME = 24;
/** What "level" means, so everyone rates on the same scale. */
const LEVEL_HINT = '1 = רק התחיל לשחק · 5 = באמצע החבורה · 10 = הכי טוב אצלנו';

/** True when the sliders were moved away from what level + cards give. */
const isTuned = (attrs: Attributes, cards: CardId[]) => {
  const base = applyCards(attrs.overall, cards);
  return ATTR_KEYS.some((k) => attrs[k] !== base[k]);
};

const POSITIONS_LABEL = (
  <span className="label">
    איפה הוא חזק? <small>לא חובה · אפשר כמה</small>
  </span>
);

/**
 * "More about the player", folded: the cards, and folded inside them the per-attribute sliders.
 * The open state is only the initial one (so removing the last card doesn't snap it shut).
 */
function MoreAboutPlayer({
  attrs,
  cards,
  open,
  detailedOpen,
  onCards,
  onAttrs,
}: {
  attrs: Attributes;
  cards: CardId[];
  open?: boolean;
  detailedOpen?: boolean;
  onCards: (c: CardId[]) => void;
  onAttrs: (a: Attributes) => void;
}) {
  const [initial] = useState({ open, detailedOpen });
  const tuned = isTuned(attrs, cards);
  return (
    <details className="fold more" open={initial.open}>
      <summary>
        עוד על השחקן
        {cards.length ? <CardBadges cards={cards} all /> : <small>לא חובה</small>}
      </summary>
      <span className="label first">
        איזה שחקן הוא? <small>עד {MAX_CARDS}</small>
      </span>
      <CardPicker value={cards} onToggle={(id) => onCards(toggleCard(cards, id))} />
      <details className="fold detailed" open={initial.detailedOpen}>
        <summary>
          דירוג מפורט מתקדם <small>{tuned ? 'כוונן ידנית' : 'לשחק עם המספרים'}</small>
        </summary>
        <p className="hint small">מתחיל מהרמה ומהכרטיסיות. שינוי רמה או כרטיסייה מחשב אותו מחדש.</p>
        <AttrSliders attrs={attrs} onChange={onAttrs} />
      </details>
    </details>
  );
}

export function PlayersScreen() {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [cards, setCards] = useState<CardId[]>([]);
  const [canGK, setCanGK] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [attrs, setAttrs] = useState<Attributes>(() => applyCards(5, []));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Player | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Player | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Level/cards rebuild the attributes; the detailed sliders fine-tune after that.
  const setProfile = (l: number, c: CardId[]) => {
    setLevel(l);
    setCards(c);
    setAttrs(applyCards(l, c));
  };

  const nameTaken = (n: string, exceptId?: string) => state.players.some((p) => p.id !== exceptId && p.name.trim() === n.trim());

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('צריך שם');
    if (nameTaken(n)) return setError('כבר יש שחקן בשם הזה. אפשר להוסיף כינוי, למשל "דני ג׳"');
    const player = withPositions<Player>({ id: newId(), name: n, attrs: { ...attrs, overall: level }, canGK, cards }, positions);
    dispatch({ type: 'addPlayer', player, present: true });
    notify(`${n} נוסף ומסומן שהגיע`);
    setName('');
    setProfile(5, []);
    setCanGK(false);
    setPositions([]);
    setError(null);
    nameRef.current?.focus();
  };

  const fixedKeepers = state.settings.gkMode === 'fixed';
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
        <LevelPicker value={level} onChange={(l) => setProfile(l, cards)} />
        <p className="hint small level-hint">{LEVEL_HINT}</p>
        {POSITIONS_LABEL}
        <PositionPicker
          canGK={canGK}
          positions={positions}
          fixedKeepers={fixedKeepers}
          onChange={(gk, ps) => {
            setCanGK(gk);
            setPositions(ps);
          }}
        />
        <MoreAboutPlayer attrs={{ ...attrs, overall: level }} cards={cards} onCards={(c) => setProfile(level, c)} onAttrs={setAttrs} />
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
            <SwipeRow key={p.id} actionLabel={`מחיקת ${p.name}`} onDelete={() => setDeleting(p)}>
              <button type="button" onClick={() => setEditing(p)}>
                <span className="name">{p.name}</span>
                <PositionBadges player={p} />
                <CardBadges cards={p.cards} all />
                <span className="level" aria-label={`רמה ${p.attrs.overall}`}>
                  {p.attrs.overall}
                </span>
              </button>
            </SwipeRow>
          ))}
        </ul>
      )}

      {editing && (
        <PlayerSheet
          player={editing}
          nameTaken={nameTaken}
          fixedKeepers={fixedKeepers}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            dispatch({ type: 'updatePlayer', player: p });
            notify('נשמר');
            setEditing(null);
          }}
          onDelete={(p) => {
            setEditing(null);
            setDeleting(p);
          }}
        />
      )}
      {deleting && (
        <DeletePlayerSheet
          player={deleting}
          onCancel={() => {
            setDeleting(null);
            closeSwipeRows();
          }}
          onConfirm={() => {
            dispatch({ type: 'deletePlayer', id: deleting.id });
            notify(`${deleting.name} נמחק`);
            setDeleting(null);
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
  // Level/cards rebuild the attributes; the detailed sliders fine-tune after that.
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
        <p className="hint small level-hint">{LEVEL_HINT}</p>
        {POSITIONS_LABEL}
        <PositionPicker
          canGK={draft.canGK}
          positions={draft.positions ?? []}
          fixedKeepers={fixedKeepers}
          onChange={(gk, ps) => setDraft((d) => withPositions({ ...d, canGK: gk }, ps))}
        />
        <MoreAboutPlayer
          attrs={draft.attrs}
          cards={draft.cards}
          open={player.cards.length > 0 || isTuned(player.attrs, player.cards)}
          detailedOpen={isTuned(player.attrs, player.cards)}
          onCards={(c) => setProfile(draft.attrs.overall, c)}
          onAttrs={(a) => setDraft((d) => ({ ...d, attrs: a }))}
        />
        <div className="stack">
          <button type="submit" className="btn btn-primary btn-block">
            שמירה
          </button>
          <button type="button" className="btn btn-quiet danger btn-block" onClick={() => onDelete(player)}>
            מחיקה
          </button>
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
        if (b.history?.length) dispatch({ type: 'mergeHistory', records: b.history });
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
      <p className="lead">שחקן בכל שורה: שם, ואחריו רמה (לא חובה). אפשר להוסיף עמדות (״שוער״, ״הגנה״, ״קישור״, ״התקפה״) ושמות של כרטיסיות, למשל ״הקוסם״ או ״איטי״.</p>
      <pre className="example" dir="rtl">{'אבי 8 קישור\nדני הקטן, 6, שוער, הגנה\nנועם, 7, התקפה, הקוסם, לא חוזר להגנה\nיוסי'}</pre>
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
                {p.name} <span className="muted">{p.attrs.overall}</span> <PositionBadges player={p} /> <CardBadges cards={p.cards} all />
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
