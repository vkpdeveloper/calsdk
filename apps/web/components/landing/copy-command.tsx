'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="group flex h-11 items-center gap-3 rounded-lg border border-line bg-panel px-4 font-mono text-sm text-neutral-300 transition-colors hover:border-neutral-600"
      aria-label={`Copy ${command}`}
    >
      <span className="text-neutral-500">$</span>
      {command}
      {copied ? (
        <Check className="size-4 text-accent-blue" />
      ) : (
        <Copy className="size-4 text-neutral-500 group-hover:text-neutral-300" />
      )}
    </button>
  );
}
