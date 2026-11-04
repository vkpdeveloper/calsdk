'use client';

import { Check } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export type Feature = {
  id: string;
  label: string;
  title: string;
  points: string[];
  code: ReactNode;
};

/** Full-width tabs, each with a short pitch on the left and its code on the right. */
export function FeatureTabs({ features }: { features: Feature[] }) {
  const [active, setActive] = useState(features[0]?.id);
  const feature = features.find((f) => f.id === active) ?? features[0];
  return (
    <div>
      <div role="tablist" aria-label="Feature" className="flex border-y border-line">
        {features.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={f.id === feature?.id}
            onClick={() => setActive(f.id)}
            className="relative h-14 min-w-0 flex-1 border-r border-line px-2 text-[13px] sm:px-4 sm:text-sm text-neutral-400 transition-colors last:border-r-0 hover:text-white aria-selected:bg-white/[0.04] aria-selected:text-white aria-selected:before:absolute aria-selected:before:inset-x-0 aria-selected:before:top-0 aria-selected:before:h-0.5 aria-selected:before:bg-accent-blue"
          >
            {f.label}
          </button>
        ))}
      </div>
      {feature && (
        <div role="tabpanel" className="grid lg:grid-cols-[0.8fr_1.2fr]">
          <div className="px-5 py-10 sm:px-10 lg:py-14">
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
              {feature.title}
            </h3>
            <ul className="mt-6 space-y-3">
              {feature.points.map((point) => (
                <li key={point} className="flex gap-3 text-neutral-300">
                  <Check className="mt-1 size-4 shrink-0 text-accent-blue" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid-texture min-w-0 border-line p-4 sm:p-10 lg:border-l">
            <div className="code overflow-hidden rounded-xl border border-line bg-panel/95">
              {feature.code}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
