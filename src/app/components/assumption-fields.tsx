'use client';

import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import type { Assumptions } from '../../lib/revenue';

const fields = [
  ['inquiriesPerMonth', 'Monthly inquiries', 1, 1_000_000, 1],
  ['averageTicket', 'Average sale', 1, 10_000_000, 1],
  ['afterHoursShare', 'After-hours inquiries', 100, 100, 0.1],
  ['afterHoursCapture', 'After-hours capture', 100, 100, 0.1],
  ['closeRate', 'Close rate', 100, 100, 0.1],
  ['speedLossRate', 'Mobile speed loss', 100, 100, 0.1],
  ['bookingDropRate', 'Booking loss', 100, 100, 0.1],
] as const;

export type AssumptionEdits = Partial<Record<keyof Assumptions, string>>;

export function assumptionOverrides(edits: AssumptionEdits): Partial<Assumptions> {
  const values: Partial<Assumptions> = {};
  for (const [key, , scale, max] of fields) {
    const raw = edits[key];
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= max) values[key] = value / scale;
  }
  return values;
}

export default function AssumptionFields({ edits, onChange, defaults, currency }: {
  edits: AssumptionEdits;
  onChange: (key: keyof Assumptions, value: string) => void;
  defaults?: Assumptions;
  currency: string;
}) {
  const id = useId();
  return (
    <div className="assumption-fields">
      {fields.map(([key, label, scale, max, increment]) => {
        const unit = scale === 100 ? '%' : key === 'averageTicket' ? currency : '';
        const fallback = defaults ? String(Number((defaults[key] * scale).toFixed(4))) : '';
        const fieldId = `${id}-${key}`;
        const value = edits[key] ?? fallback;
        function adjust(direction: number) {
          const current = Number(value || fallback);
          const next = Math.min(max, Math.max(0, current + increment * direction));
          onChange(key, String(Number(next.toFixed(4))));
        }
        return (
          <div className="field" key={key}>
            <label htmlFor={fieldId}>{label}{unit && <span className="optional"> ({unit})</span>}</label>
            <div className="stepper">
              <input id={fieldId} type="number" inputMode={increment === 1 ? 'numeric' : 'decimal'} min={0} max={max}
                step="any" value={value} placeholder="Default" onChange={event => onChange(key, event.currentTarget.value)} />
              <button type="button" aria-label={`Decrease ${label}`} onClick={() => adjust(-1)}><Minus size={14} /></button>
              <button type="button" aria-label={`Increase ${label}`} onClick={() => adjust(1)}><Plus size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
