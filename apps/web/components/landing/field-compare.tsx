'use client';

import { ArrowDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Mark } from '@/components/logo';

const FIELDS = [
  { id: 'title', label: 'Title' },
  { id: 'start', label: 'Start time' },
  { id: 'repeat', label: 'Repeats' },
  { id: 'link', label: 'Video link' },
] as const;

type Field = (typeof FIELDS)[number]['id'];

export type Payload = {
  name: string;
  format: string;
  code: ReactNode;
  result: ReactNode;
  /** What is odd about this API's version of each field, shown under its payload. */
  notes: Record<Field, string>;
};

/**
 * The same meeting as each provider's API returns it, next to the calsdk event made from the
 * picked payload. Picking a field lights up its lines everywhere; the lines carry `field-*`
 * classes, and each payload's note says what is odd about that field in its API. Phones
 * show one payload at a time, so the calsdk event sits right under it.
 */
export function FieldCompare({ payloads }: { payloads: Payload[] }) {
  const [field, setField] = useState<Field>('repeat');
  const [shown, setShown] = useState(0);
  const picked = payloads[shown];
  return (
    <div className="compare" data-field={field}>
      <fieldset
        aria-label="Field"
        className="mb-6 grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:gap-2"
      >
        {FIELDS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === field}
            onClick={() => setField(id)}
            className="h-11 rounded-full border border-line px-1 text-[13px] whitespace-nowrap sm:h-10 sm:px-4 sm:text-sm text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white aria-pressed:border-accent-blue aria-pressed:bg-accent-blue/10 aria-pressed:text-white"
          >
            {label}
          </button>
        ))}
      </fieldset>
      <div
        role="tablist"
        aria-label="Provider"
        className="mb-3 flex border-b border-line md:hidden"
      >
        {payloads.map(({ name }, i) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={i === shown}
            onClick={() => setShown(i)}
            className="-mb-px h-11 flex-1 border-b-2 border-transparent px-1 text-[13px] text-neutral-400 aria-selected:border-accent-blue aria-selected:text-white"
          >
            {name.replace(' Calendar', '')}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:col-span-2">
          {payloads.map(({ name, format, code, notes }, i) => (
            <div
              key={name}
              className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-panel transition-colors ${i === shown ? 'border-accent-blue/60' : 'border-line hover:border-neutral-600 max-md:hidden'}`}
            >
              <button
                type="button"
                aria-pressed={i === shown}
                onClick={() => setShown(i)}
                className="group flex w-full cursor-pointer items-center gap-2 border-b border-line px-4 py-2.5 text-left text-xs hover:bg-white/[0.03]"
              >
                {/* A radio-style dot: the cards are a choice of which payload feeds the result. */}
                <span className="size-2.5 rounded-full border border-neutral-500 group-hover:border-neutral-300 group-aria-pressed:border-accent-blue group-aria-pressed:bg-accent-blue" />
                <span className="font-medium text-neutral-200">{name}</span>
                <span className="ml-auto font-mono text-neutral-400">{format}</span>
              </button>
              {/* Grows so the notes line up along the bottom of each row of cards. */}
              <div className="code code-sm flex-1">{code}</div>
              <p className="border-t border-line px-4 py-2.5 text-xs text-neutral-400">
                {notes[field]}
              </p>
            </div>
          ))}
        </div>
        <div className="flex justify-center text-neutral-500 lg:hidden">
          <ArrowDown className="size-5" />
        </div>
        <div className="min-w-0 self-start overflow-hidden rounded-xl border border-accent-blue/60 lg:sticky lg:top-24 bg-panel shadow-[0_0_0_4px_rgb(79_124_255/0.08)]">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
            <Mark className="size-4 text-white" />
            <span className="font-medium text-white">calsdk</span>
            <span className="ml-auto font-mono text-neutral-400">
              Event from {picked?.name.replace(' Calendar', '')}
            </span>
          </div>
          <div className="code code-sm">{picked?.result}</div>
        </div>
      </div>
    </div>
  );
}
