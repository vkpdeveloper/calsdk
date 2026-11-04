'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
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
        setTimeout(() => setState('idle'), 1500);
      }}
      className="group flex h-11 items-center gap-3 rounded-lg border border-line bg-panel px-4 font-mono text-sm text-neutral-300 transition-colors hover:border-neutral-600"
      aria-label={`Copy ${command}`}
    >
      <span className="text-neutral-500">$</span>
      <span className="select-all">{command}</span>
      {state === 'copied' ? (
        <Check className="size-4 text-accent-blue" />
      ) : (
        <Copy className="size-4 text-neutral-500 group-hover:text-neutral-300" />
      )}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  );
}
