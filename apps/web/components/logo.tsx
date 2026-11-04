import { useId } from 'react';

/** The calsdk tile: a calendar with today cut out in the accent blue. Same shapes as assets/icon.svg. */
export function Mark({ className }: { className?: string }) {
  // A unique mask id per mark: a mark hidden with `display: none` would break every other
  // mark that pointed at its mask.
  const mask = useId();
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
        <rect width="48" height="48" fill="#fff" />
        <rect x="12.5" y="2" width="9" height="15" rx="4.5" />
        <rect x="26.5" y="2" width="9" height="15" rx="4.5" />
        <rect x="25" y="25" width="12" height="12" rx="3.6" />
      </mask>
      <rect x="5" y="9" width="38" height="35" rx="10" fill="currentColor" mask={`url(#${mask})`} />
      <rect x="15" y="4" width="4" height="10.5" rx="2" fill="currentColor" />
      <rect x="29" y="4" width="4" height="10.5" rx="2" fill="currentColor" />
      <rect x="27" y="27" width="8" height="8" rx="2.2" fill="#4f7cff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-[1.0625rem] font-semibold tracking-[-0.04em]">
      <Mark className="size-6" />
      calsdk
    </span>
  );
}
