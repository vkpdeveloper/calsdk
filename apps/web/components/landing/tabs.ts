import type { KeyboardEvent } from 'react';

const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/**
 * Arrow keys, Home and End for a tab list with a roving tabindex. Tabs need the id
 * `${prefix}-tab-${id}` so the newly selected one can take focus.
 */
export function onTabKeyDown<Id extends string>(
  event: KeyboardEvent,
  {
    ids,
    active,
    prefix,
    select,
  }: {
    ids: Id[];
    active: Id | undefined;
    prefix: string;
    select: (id: Id) => void;
  },
) {
  const step = STEPS[event.key];
  if (!step) return;
  event.preventDefault();
  const index = active === undefined ? 0 : Math.max(ids.indexOf(active), 0);
  const next = ids[step(index, ids.length)];
  if (next === undefined) return;
  select(next);
  document.getElementById(`${prefix}-tab-${next}`)?.focus();
}
