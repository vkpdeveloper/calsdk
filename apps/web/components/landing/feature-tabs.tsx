'use client';

import { type ReactNode, useId, useState } from 'react';
import { onTabKeyDown } from './tabs';

export type Feature = {
  id: string;
  label: string;
  title: string;
  body: string;
  code: ReactNode;
};

/** Segmented tabs over a short pitch and its code. */
export function FeatureTabs({ features }: { features: Feature[] }) {
  const [active, setActive] = useState(features[0]?.id);
  const feature = features.find((f) => f.id === active) ?? features[0];
  const prefix = useId();
  return (
    <div>
      <div
        role="tablist"
        aria-label="Feature"
        onKeyDown={(event) =>
          onTabKeyDown(event, {
            ids: features.map((f) => f.id),
            active: feature?.id,
            prefix,
            select: setActive,
          })
        }
        className="x-scroll -mx-5 flex gap-1 overflow-x-auto px-5 sm:mx-0 sm:px-0"
      >
        {features.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            id={`${prefix}-tab-${f.id}`}
            aria-controls={`${prefix}-panel`}
            tabIndex={f.id === feature?.id ? 0 : -1}
            aria-selected={f.id === feature?.id}
            onClick={() => setActive(f.id)}
            className="h-11 shrink-0 rounded-full border border-transparent px-4 text-sm text-neutral-400 transition-colors hover:text-white aria-selected:border-line aria-selected:bg-white/[0.06] aria-selected:text-white sm:h-10"
          >
            {f.label}
          </button>
        ))}
      </div>
      {feature && (
        <div
          id={`${prefix}-panel`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-${feature.id}`}
          className="mt-6 grid overflow-hidden rounded-2xl border border-line bg-panel lg:min-h-[38rem] lg:grid-cols-[20rem_minmax(0,1fr)]"
        >
          <div className="border-line p-6 max-lg:border-b sm:p-8 lg:border-r">
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-white">{feature.title}</h3>
            <p className="mt-3 leading-relaxed text-neutral-400">{feature.body}</p>
          </div>
          <div className="code min-w-0 py-2">{feature.code}</div>
        </div>
      )}
    </div>
  );
}
