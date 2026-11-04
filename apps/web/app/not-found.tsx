import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { Metadata } from 'next';
import Link from 'next/link';
import { baseOptions } from '@/lib/layout.shared';

export const metadata: Metadata = { title: 'Page not found' };

// Shown for any unknown URL, including a missing docs page. The home layout keeps the top bar,
// so search is one tap away.
export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col border-x border-line">
        <section className="hero-grid relative flex-1 overflow-hidden px-5 pt-16 pb-20 sm:px-10 sm:pt-24">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-400">404</p>
          <h1 className="mt-6 max-w-3xl text-balance text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.95] font-semibold tracking-[-0.05em] text-white">
            This page isn't on the calendar.
          </h1>

          <div className="mt-10 max-w-md rounded-xl border border-line bg-panel p-4">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-neutral-200 line-through decoration-neutral-500">
                This page
              </span>
              <code className="font-mono text-neutral-400">status: 'cancelled'</code>
            </div>
            <p className="mt-3 font-mono text-xs text-accent-blue">NotFoundError</p>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-300">
              It moved or never existed. Search from the top bar, or start from the docs.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              className="flex h-11 items-center rounded-full bg-white px-6 text-sm font-medium text-black hover:bg-neutral-200"
            >
              Go to the docs
            </Link>
            <Link
              href="/"
              className="flex h-11 items-center rounded-full border border-line px-6 text-sm font-medium text-neutral-200 hover:border-neutral-500"
            >
              Home
            </Link>
          </div>
        </section>
      </div>
    </HomeLayout>
  );
}
