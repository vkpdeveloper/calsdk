'use client';

import { ArrowDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Mark } from '@/components/logo';

const FIELDS = [
  { id: 'title', label: 'Title' },
  { id: 'start', label: 'Start time' },
  { id: 'repeat', label: 'Repeats' },
  { id: 'link', label: 'Video link' },
];

export type Payload = { name: string; format: string; code: ReactNode };

/**
 * The same meeting as each provider's API returns it, next to the calsdk event. Picking a
 * field lights up its lines in every payload; the lines carry `field-*` classes.
 */
export function FieldCompare({ payloads, result }: { payloads: Payload[]; result: ReactNode }) {
  const [field, setField] = useState('repeat');
  return (
    <div className="compare" data-field={field}>
      <fieldset aria-label="Field" className="mb-6 flex flex-wrap gap-2">
        {FIELDS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === field}
            onClick={() => setField(id)}
            className="h-10 rounded-full border border-line px-4 text-sm text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white aria-pressed:border-accent-blue aria-pressed:bg-accent-blue/10 aria-pressed:text-white"
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:col-span-2">
          {payloads.map(({ name, format, code }) => (
            <div
              key={name}
              className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs">
                <span className="font-medium text-neutral-200">{name}</span>
                <span className="font-mono text-neutral-500">{format}</span>
              </div>
              <div className="code code-sm">{code}</div>
            </div>
          ))}
        </div>
        <div className="flex justify-center text-neutral-500 lg:hidden">
          <ArrowDown className="size-5" />
        </div>
        <div className="min-w-0 self-center overflow-hidden rounded-xl border border-accent-blue/60 bg-panel shadow-[0_0_0_4px_rgb(79_124_255/0.08)]">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
            <Mark className="size-4 text-white" />
            <span className="font-medium text-white">calsdk</span>
            <span className="ml-auto font-mono text-neutral-500">Event</span>
          </div>
          <div className="code code-sm">{result}</div>
        </div>
      </div>
    </div>
  );
}
