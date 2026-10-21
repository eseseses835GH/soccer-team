// "ייבוא רשימה": a pasted/typed list, a CSV or backup file, a WhatsApp chat export (.txt/.zip, also
// shared straight from WhatsApp on Android), a participants CSV, or the phone's contacts. Names
// without levels are picked from a checklist, then rated one by one (DECISIONS → v14).
import { useEffect, useRef, useState } from 'react';
import type { Position } from '../engine';
import { applyCards } from '../state/cards';
import { ROSTER_TEMPLATE, parseBackup, parseRoster, restoreBackup, type ParsedRoster } from '../state/io';
import { newId, type Player } from '../state/model';
import { nextStep, rateStep, roundDone, startRound, type Round } from '../state/quickRate';
import { useGroups, useStore } from '../state/store';
import { fromNames, isWhatsAppChat, nameKey, parseWhatsAppChat, pickNames, readFileText, takeShared, type PickedNames } from '../state/whatsapp';
import { downloadText } from '../share';
import { usePlayerVotes } from '../sync/OrganizerSync';
import { useVoterId } from '../sync/SyncProvider';
import { useUi } from './App';
import { CardBadges, PositionBadges, PositionPicker, Sheet } from './components';
import { Icon } from './icons';
import { usePlayerGate } from './useGate';

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const UNNAMED = 'בלי שם';

interface ContactsManager {
  select(props: string[], opts: { multiple: boolean }): Promise<{ name?: string[] }[]>;
}
const contacts = () => (typeof navigator !== 'undefined' ? (navigator as Navigator & { contacts?: ContactsManager }).contacts : undefined);

const added = (n: number) => (n === 1 ? 'נוסף שחקן אחד' : `נוספו ${n} שחקנים`);

export function ImportSheet({ onClose, shared = false }: { onClose: () => void; shared?: boolean }) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const groups = useGroups();
  const gate = usePlayerGate();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<PickedNames | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [withUnnamed, setWithUnnamed] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed: ParsedRoster = parseRoster(text, state.players.map((p) => p.name));
  const inRoster = new Set(state.players.map((p) => nameKey(p.name)));

  const showPicked = (p: PickedNames) => {
    if (!p.names.length && !p.unnamed) return notify('לא נמצאו שמות');
    setPicked(p);
    setOff(new Set());
    setWithUnnamed(false);
  };

  const commit = (players: Player[]) =>
    gate(players, () => {
      for (const p of players) dispatch({ type: 'addPlayer', player: p });
      notify(added(players.length));
      onClose();
    });

  const commitPicked = () => {
    if (!picked) return;
    const names = picked.names.map((n) => n.name).filter((n) => !inRoster.has(nameKey(n)) && !off.has(nameKey(n)));
    if (withUnnamed) {
      for (let i = 1, made = 0; made < picked.unnamed; i++) {
        const n = `${UNNAMED} ${i}`;
        if (!inRoster.has(nameKey(n))) {
          names.push(n);
          made++;
        }
      }
    }
    const players: Player[] = names.map((name) => ({ id: newId(), name, attrs: applyCards(5, []), canGK: false, cards: [] }));
    // Logged out past the free limit: log in first, then all of them (v13).
    gate(players, () => {
      // After a login the roster may have changed meanwhile.
      const taken = new Set(groups.latest().app.players.map((p) => nameKey(p.name)));
      const fresh = players.filter((p) => !taken.has(nameKey(p.name)));
      for (const p of fresh) dispatch({ type: 'addPlayer', player: p });
      notify(added(fresh.length));
      setPicked(null);
      if (fresh.length) setRound(startRound(fresh.map((p) => p.id)));
      else onClose();
    });
  };

  const onBlob = async (file: Blob, name = '') => {
    try {
      if (name.toLowerCase().endsWith('.json')) {
        const b = parseBackup(JSON.parse(await file.text()));
        if (!b) return notify('הקובץ לא נראה כמו גיבוי של כוחות');
        const fresh = restoreBackup(state.players, state.constraints, b).players.filter((p) => !state.players.some((x) => x.id === p.id));
        gate(fresh, () => {
          // After a login the roster may have changed meanwhile: merge into the latest one.
          const now = groups.latest().app;
          const r = restoreBackup(now.players, now.constraints, b);
          dispatch({ type: 'importPlayers', players: r.players, constraints: r.constraints });
          if (b.history?.length) dispatch({ type: 'mergeHistory', records: b.history });
          notify(r.added === 0 ? 'כל השחקנים מהקובץ כבר ברשימה' : added(r.added));
          onClose();
        });
        return;
      }
      const content = await readFileText(file);
      const p = pickNames(content);
      if (p) showPicked(p);
      else setText(content);
    } catch {
      notify('לא הצלחתי לקרוא את הקובץ');
    }
  };

  // Shared from WhatsApp to the installed app: read it once (it's deleted right away).
  const sharedOnce = useRef(shared);
  useEffect(() => {
    if (!sharedOnce.current) return;
    sharedOnce.current = false;
    history.replaceState(null, '', '#players');
    takeShared().then((b) => (b ? onBlob(b) : notify('לא הגיע קובץ')));
  }, []);

  const fromContacts = async () => {
    try {
      const list = await contacts()!.select(['name'], { multiple: true });
      if (list.length) showPicked(fromNames(list.map((c) => c.name?.[0] ?? '')));
    } catch {
      /* closed */
    }
  };

  if (round) return <QuickRate round={round} onRound={setRound} onClose={onClose} />;

  if (picked) {
    const chosen = picked.names.filter((n) => !inRoster.has(nameKey(n.name)) && !off.has(nameKey(n.name))).length + (withUnnamed ? picked.unnamed : 0);
    const toggle = (k: string) => setOff((s) => new Set(s.has(k) ? [...s].filter((x) => x !== k) : [...s, k]));
    return (
      <Sheet title="ייבוא רשימה" onClose={onClose}>
        <div className="card-chips wa-picks" role="group" aria-label="מי נכנס">
          {picked.names.map(({ name }) => {
            const k = nameKey(name);
            const have = inRoster.has(k);
            const on = !have && !off.has(k);
            return (
              <button key={k} type="button" className={`card-chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={have} onClick={() => toggle(k)}>
                {name}
                {have && <small>כבר ברשימה</small>}
              </button>
            );
          })}
          {picked.unnamed > 0 && (
            <button type="button" className={`card-chip ${withUnnamed ? 'on' : ''}`} aria-pressed={withUnnamed} onClick={() => setWithUnnamed((v) => !v)}>
              {picked.unnamed === 1 ? 'מספר בלי שם' : `${picked.unnamed} מספרים בלי שם`}
            </button>
          )}
        </div>
        <button type="button" className="btn btn-primary btn-block" disabled={!chosen} onClick={commitPicked}>
          {chosen === 1 ? 'הוספת שחקן אחד' : `הוספת ${chosen || ''} שחקנים`.replace('  ', ' ')}
        </button>
        <div className="row-links">
          <button type="button" className="text-btn" onClick={() => setPicked(null)}>
            חזרה
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="ייבוא רשימה" onClose={onClose}>
      <div className="stack">
        <button type="button" className="btn btn-wa btn-block" onClick={() => fileRef.current?.click()}>
          <Icon name="whatsapp" size={20} /> מצ'אט בוואטסאפ
        </button>
        {contacts()?.select && (
          <button type="button" className="btn btn-quiet btn-block" onClick={() => void fromContacts()}>
            <Icon name="users" size={20} /> מאנשי הקשר
          </button>
        )}
      </div>
      <details className="fold wa-help">
        <summary>איך מייצאים צ'אט?</summary>
        <ol className="steps">
          <li>בקבוצה בוואטסאפ: פרטי הקבוצה (באנדרואיד גם ⋮ ← עוד)</li>
          <li>ייצוא צ'אט ← ללא מדיה</li>
          <li>שומרים בקבצים ובוחרים אותו כאן. באנדרואיד אפשר לשתף ישר ל״כוחות״</li>
        </ol>
        <p className="hint small">מי שלא כתב בקבוצה לא יופיע.</p>
      </details>
      <p className="lead import-lead">או שחקן בכל שורה: שם, ואחריו רמה (לא חובה). אפשר להוסיף עמדות (״טוב בשער״, ״הגנה״, ״קישור״, ״התקפה״) ושמות של כרטיסיות, למשל ״קוסם״ או ״איטי״.</p>
      <pre className="example" dir="rtl">{'אבי 8 קישור\nדני הקטן, 6, טוב בשער, הגנה\nנועם, 7, התקפה, קוסם, עצלן\nיוסי'}</pre>
      <textarea
        className="input textarea"
        rows={6}
        placeholder="מדביקים כאן…"
        value={text}
        onChange={(e) => (isWhatsAppChat(e.target.value) ? showPicked(parseWhatsAppChat(e.target.value)) : setText(e.target.value))}
        aria-label="רשימת שחקנים"
      />
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
          accept=".csv,.txt,.zip,.json,text/csv,text/plain,application/zip,application/json"
          hidden
          aria-label="קובץ לייבוא"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onBlob(f, f.name);
            e.target.value = '';
          }}
        />
      </div>
      {text.trim() && (
        <div className="preview">
          <p>
            {parsed.players.length === 1 ? (
              'שחקן אחד מוכן'
            ) : (
              <>
                <strong>{parsed.players.length}</strong> שחקנים מוכנים
              </>
            )}
            {parsed.skipped.length > 0 && (parsed.skipped.length === 1 ? ', אחד דולג' : `, ${parsed.skipped.length} דולגו`)}
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
        {parsed.players.length === 1 ? 'הוספת שחקן אחד' : `הוספת ${parsed.players.length || ''} שחקנים`.replace('  ', ' ')}
      </button>
    </Sheet>
  );
}

/** One new player at a time: optional positions, then a level (saved at once) — or skip (stays 5). */
function QuickRate({ round, onRound, onClose }: { round: Round; onRound: (r: Round) => void; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const voter = useVoterId();
  const playerVotes = usePlayerVotes().rows;
  const [gk, setGk] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const p = roundDone(round) ? undefined : state.players.find((x) => x.id === round.ids[round.at]);

  useEffect(() => {
    if (!p && !roundDone(round)) onRound(nextStep(round, state.players));
    else if (roundDone(round)) onClose();
  }, [p, round, state.players, onRound, onClose]);
  if (!p) return null;

  const next = () => {
    setGk(false);
    setPositions([]);
    onRound(nextStep(round, state.players));
  };
  const rate = (level: number) => {
    dispatch({ type: 'updatePlayer', player: rateStep(p, level, gk, positions, voter, playerVotes) });
    next();
  };

  return (
    <Sheet title="דירוג מהיר" onClose={onClose}>
      <div className="rate quick-rate">
        <p className="rate-progress" dir="ltr">
          {round.at + 1}/{round.ids.length}
        </p>
        <h3 className="rate-name">{p.name}</h3>
        <PositionPicker
          canGK={gk}
          positions={positions}
          fixedKeepers={state.settings.gkMode === 'fixed'}
          onChange={(g, ps) => {
            setGk(g);
            setPositions(ps);
          }}
        />
        <div className="rate-levels" role="radiogroup" aria-label={`רמה של ${p.name}`}>
          {LEVELS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={false} onClick={() => rate(n)}>
              {n}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-quiet btn-block" onClick={next}>
          דילוג
        </button>
        <div className="row-links">
          <button type="button" className="text-btn" onClick={onClose}>
            סיום
          </button>
        </div>
      </div>
    </Sheet>
  );
}
