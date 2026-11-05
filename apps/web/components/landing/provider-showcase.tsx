'use client';

import { type ReactNode, useId, useState } from 'react';
import { ProviderLogo, type ProviderLogoId } from '@/components/provider-logo';
import { onTabKeyDown } from './tabs';

export type ShowcaseProvider = {
  id: ProviderLogoId;
  label: string;
  pkg: string;
  code: ReactNode;
  /** What the provider supports, as [capability, note or true/false]. */
  support: [string, boolean | string][];
};

/** The provider picker: the same listEvents call for each, with the two changed lines lit. */
export function ProviderShowcase({ providers }: { providers: ShowcaseProvider[] }) {
  const [active, setActive] = useState(providers[0]?.id);
  const current = providers.find((provider) => provider.id === active) ?? providers[0];
  const prefix = useId();

  return (
    <div className="grid overflow-hidden rounded-2xl border border-line bg-panel lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div
        role="tablist"
        aria-label="Calendar provider"
        onKeyDown={(event) =>
          onTabKeyDown(event, {
            ids: providers.map((provider) => provider.id),
            active: current?.id,
            prefix,
            select: setActive,
          })
        }
        className="grid grid-cols-3 gap-1 border-line p-2 max-lg:border-b lg:grid-cols-1 lg:content-start lg:border-r"
      >
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            role="tab"
            id={`${prefix}-tab-${provider.id}`}
            aria-controls={`${prefix}-panel-${provider.id}`}
            tabIndex={provider.id === current?.id ? 0 : -1}
            aria-selected={provider.id === current?.id}
            onClick={() => setActive(provider.id)}
            className="flex h-11 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-sm text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-white aria-selected:bg-white/[0.07] aria-selected:text-white lg:h-10 lg:gap-2.5 lg:px-3"
          >
            <ProviderLogo id={provider.id} />
            <span className="truncate">{provider.label}</span>
            <span className="ml-auto hidden whitespace-nowrap font-mono text-[11px] text-neutral-500 lg:inline">
              {provider.pkg}
            </span>
          </button>
        ))}
      </div>

      {/* Every provider's panel is in the HTML, so crawlers and answer engines read all of them.
          A panel's flash restarts each time it's shown, since hiding it stops the animation. */}
      {providers.map((provider) => (
        <div
          key={provider.id}
          id={`${prefix}-panel-${provider.id}`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-${provider.id}`}
          hidden={provider.id !== current?.id}
          className="flex min-w-0 flex-col"
        >
          <div className="code code-flash flex-1 py-2">{provider.code}</div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-5 py-4 text-sm">
            {provider.support.map(([capability, value]) => (
              <li key={capability} className="flex items-center gap-2">
                {/* Full support is a filled dot, partial support a ring with its note. */}
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    value === true
                      ? 'bg-accent-blue'
                      : value === false
                        ? 'border border-neutral-500'
                        : 'border border-accent-blue'
                  }`}
                />
                <span
                  className={value === false ? 'text-neutral-500 line-through' : 'text-neutral-200'}
                >
                  {capability}
                </span>
                {typeof value === 'string' && <span className="text-neutral-500">{value}</span>}
                {typeof value === 'boolean' && (
                  <span className="sr-only">{value ? ', supported' : ', not supported'}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
