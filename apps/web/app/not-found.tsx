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
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col">
        <section className="flex-1 px-5 pt-16 pb-20 sm:px-8 sm:pt-24">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-400">404</p>
          <h1 className="mt-6 max-w-3xl text-balance text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.95] font-semibold tracking-[-0.05em] text-white">
            This page isn't on the calendar.
          </h1>

          <div className="mt-10 max-w-md rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-neutral-200 line-through decoration-neutral-500">
                This page
              </span>
              <code className="font-mono text-accent-blue">NotFoundError</code>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              The page was not found. It may have moved or been deleted. Search from the top bar, or
              start from the docs.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              className="flex h-11 items-center rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200"
            >
              Go to the docs
            </Link>
            <Link
              href="/"
              className="flex h-11 items-center rounded-lg border border-line px-5 text-sm font-medium text-neutral-200 hover:border-neutral-500"
            >
              Home
            </Link>
          </div>
        </section>
      </div>
    </HomeLayout>
  );
}
