'use client';

import { type CSSProperties, type ReactNode, useState } from 'react';
import { Mark } from '@/components/logo';

export type ShowcaseProvider = {
  id: string;
  label: string;
  color: string;
  code: ReactNode;
};

const GAP = 24;

// Where the made-up events sit on each plate, as [column, top, height] in percent of a week.
const BLOCKS = [
  [
    [0, 14, 22],
    [2, 48, 30],
    [5, 22, 18],
  ],
  [
    [1, 30, 26],
    [3, 12, 20],
    [6, 56, 22],
  ],
  [
    [0, 58, 20],
    [4, 26, 34],
    [2, 10, 16],
  ],
];

/** The provider picker: a stack of calendars under calsdk, and the code for the picked one. */
export function ProviderShowcase({ providers }: { providers: ShowcaseProvider[] }) {
  const [active, setActive] = useState(providers[0]?.id);
  const current = providers.find((provider) => provider.id === active) ?? providers[0];
  // The first provider is drawn just under calsdk, the last at the bottom.
  const plates = [...providers].reverse();

  return (
    <div className="grid border-t border-line lg:grid-cols-[1fr_1.1fr]">
      {/* Below lg the picker and code come first, so the API shows before the picture. */}
      <div className="relative h-[340px] overflow-hidden border-line max-lg:order-last max-lg:border-t sm:h-[460px] lg:h-auto lg:min-h-[520px] lg:border-r">
        <div className="iso-scene" aria-hidden>
          {plates.map((provider, i) => (
            <Plate
              key={provider.id}
              index={i}
              color={provider.color}
              label={provider.label}
              state={provider.id === current?.id ? 'active' : 'idle'}
              blocks={BLOCKS[i % BLOCKS.length] ?? []}
            />
          ))}
          <div
            className="iso-plate iso-plate-top"
            style={
              { '--i': plates.length, '--z': `${plates.length * GAP + 26}px` } as CSSProperties
            }
          >
            <Mark className="absolute left-4 top-4 size-7 text-white" />
            <span className="absolute bottom-3 left-4 font-mono text-[11px] text-white">
              calsdk
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <div
          role="tablist"
          aria-label="Calendar provider"
          className="grid grid-cols-3 border-b border-line"
        >
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="tab"
              aria-selected={provider.id === current?.id}
              onClick={() => setActive(provider.id)}
              className="-mb-px -mr-px flex h-12 items-center gap-2.5 border-b border-r border-line px-4 text-left text-sm text-neutral-400 transition-colors hover:bg-white/[0.03] hover:text-white aria-selected:bg-white/[0.05] aria-selected:text-white"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: provider.color }}
              />
              {provider.label}
            </button>
          ))}
        </div>
        {/* Keyed by provider so the changed lines flash once on every switch. */}
        <div key={current?.id} role="tabpanel" className="code code-flash flex-1 py-2">
          {current?.code}
        </div>
        <p className="border-t border-line px-5 py-3 text-sm text-neutral-400">
          Switching calendars changes the two blue lines. Nothing else.
        </p>
      </div>
    </div>
  );
}

function Plate({
  index,
  color,
  label,
  state,
  blocks,
}: {
  index: number;
  color: string;
  label: string;
  state: 'active' | 'idle';
  blocks: number[][];
}) {
  return (
    <div
      className="iso-plate"
      data-state={state}
      style={{ '--i': index, '--z': `${index * GAP}px`, '--c': color } as CSSProperties}
    >
      {blocks.map(([column = 0, top = 0, height = 0]) => (
        <span
          key={`${column}-${top}`}
          className="iso-block"
          style={{ left: `${(column / 7) * 100}%`, top: `${top}%`, height: `${height}%` }}
        />
      ))}
      <span className="iso-label">{label}</span>
    </div>
  );
}
