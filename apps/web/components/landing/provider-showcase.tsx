'use client';

import { type ReactNode, useState } from 'react';

export type ShowcaseProvider = {
  id: string;
  label: string;
  pkg: string;
  color: string;
  code: ReactNode;
  /** What the provider supports, as [capability, note or true/false]. */
  support: [string, boolean | string][];
};

/** The provider picker: the same listEvents call for each, with the two changed lines lit. */
export function ProviderShowcase({ providers }: { providers: ShowcaseProvider[] }) {
  const [active, setActive] = useState(providers[0]?.id);
  const current = providers.find((provider) => provider.id === active) ?? providers[0];

  return (
    <div className="grid overflow-hidden rounded-2xl border border-line bg-panel lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div
        role="tablist"
        aria-label="Calendar provider"
        className="grid grid-cols-3 gap-1 border-line p-2 max-lg:border-b lg:grid-cols-1 lg:content-start lg:border-r"
      >
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            role="tab"
            aria-selected={provider.id === current?.id}
            onClick={() => setActive(provider.id)}
            className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg px-3 text-left text-sm text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-white aria-selected:bg-white/[0.07] aria-selected:text-white lg:h-10"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: provider.color }} />
            <span className="truncate">{provider.label}</span>
            <span className="ml-auto hidden font-mono text-[11px] text-neutral-500 lg:inline">
              {provider.pkg}
            </span>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col">
        {/* Keyed by provider so the changed lines flash once on every switch. */}
        <div key={current?.id} role="tabpanel" className="code code-flash flex-1 py-2">
          {current?.code}
        </div>
        {current && (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-5 py-4 text-sm">
            {current.support.map(([capability, value]) => (
              <li key={capability} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${value === false ? 'border border-neutral-500' : 'bg-accent-blue'}`}
                />
                <span
                  className={value === false ? 'text-neutral-500 line-through' : 'text-neutral-200'}
                >
                  {capability}
                </span>
                {typeof value === 'string' && <span className="text-neutral-500">{value}</span>}
                <span className="sr-only">
                  {value === false ? ', not supported' : ', supported'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
