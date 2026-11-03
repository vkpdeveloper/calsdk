'use client';

import { type ReactNode, useState } from 'react';

export type CodeTab = { id: string; label: string; code: ReactNode; note?: ReactNode };

/** A code window whose tabs swap the snippet below them. */
export function TabbedCode({ tabs, label }: { tabs: CodeTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-line px-2 py-2 [scrollbar-width:none]"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab?.id}
            onClick={() => setActive(t.id)}
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-100 aria-selected:bg-neutral-800 aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="code">
        {tab?.code}
      </div>
      {tab?.note && (
        <p className="border-t border-line px-5 py-3 text-sm text-neutral-400">{tab.note}</p>
      )}
    </div>
  );
}
