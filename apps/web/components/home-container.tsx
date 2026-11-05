'use client';

import type { ComponentProps } from 'react';

// HomeLayout puts the site header inside its <main>. This container is a plain <div>, and the
// layout wraps the page itself in <main>, so the header and nav stay outside the main content.
// The layout never passes a ref, and a <main> ref doesn't fit a <div>, so it's dropped.
export function HomeContainer({ className, ref: _ref, ...props }: ComponentProps<'main'>) {
  return (
    <div
      id="nd-home-layout"
      {...props}
      className={`flex flex-1 flex-col [--fd-layout-width:1400px] ${className ?? ''}`}
    />
  );
}
