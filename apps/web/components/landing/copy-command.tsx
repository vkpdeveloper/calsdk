'use client';

import { Check, Copy, X } from 'lucide-react';
import { useRef, useState } from 'react';

export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setState('copied');
        } catch {
          // Clipboard access can be blocked. The command stays on screen to copy by hand.
          setState('failed');
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1500);
      }}
      className="group flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 font-mono text-xs whitespace-nowrap text-neutral-300 sm:gap-3 sm:px-4 sm:text-sm transition-colors hover:border-neutral-600"
      aria-label={`Copy ${command}`}
    >
      <span className="text-neutral-500">$</span>
      <span className="select-all">{command}</span>
      {state === 'copied' && <Check aria-hidden className="size-4 text-accent-blue" />}
      {state === 'failed' && <X aria-hidden className="size-4 text-red-400" />}
      {state === 'idle' && (
        <Copy aria-hidden className="size-4 text-neutral-500 group-hover:text-neutral-300" />
      )}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  );
}
