// "הגדרות הערב": the match rules a player running the evening may change for tonight
// (DECISIONS → "Runner evening settings"). Same controls as the organizer's settings screen.
import type { EveningRules } from '../state/evening';
import { Segmented, Sheet, Stepper, Toggle } from './components';

export function EveningSheet({ value, onChange, onClose }: { value: EveningRules; onChange(patch: Partial<EveningRules>): void; onClose(): void }) {
  return (
    <Sheet title="הגדרות הערב" onClose={onClose}>
      {!value.matchNoLimit && (
        <div className="field-row">
          <span>אורך משחק</span>
          <Stepper label="אורך משחק בדקות" value={value.matchMinutes} min={1} max={60} onChange={(matchMinutes) => onChange({ matchMinutes })} suffix="דק׳" />
        </div>
      )}
      <Toggle label="בלי טיימר" checked={value.matchNoLimit} onChange={(matchNoLimit) => onChange({ matchNoLimit })} />
      <div className="field-row">
        <span>תוספת בתיקו</span>
        <Segmented
          label="תוספת זמן בתיקו"
          value={value.drawExtraMinutes}
          onChange={(drawExtraMinutes) => onChange({ drawExtraMinutes })}
          options={[0, 1, 2, 3, 5].map((n) => ({ value: n, label: n ? String(n) : 'בלי' }))}
        />
      </div>
      <div className="field-row">
        <span>שוערים</span>
        <Segmented
          label="שוערים"
          value={value.gkMode}
          onChange={(gkMode) => onChange({ gkMode })}
          options={[
            { value: 'rotate', label: 'מתחלפים' },
            { value: 'fixed', label: 'קבוע' },
          ]}
        />
      </div>
      {value.gkMode === 'rotate' && (
        <div className="field-row">
          <span>מתחלפים כל</span>
          <Segmented
            label="מתחלפים כל"
            value={value.gkSwitchGoals}
            onChange={(gkSwitchGoals) => onChange({ gkSwitchGoals })}
            options={[
              { value: 1, label: 'גול' },
              { value: 2, label: '2' },
              { value: 3, label: '3' },
            ]}
          />
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        אישור
      </button>
    </Sheet>
  );
}
