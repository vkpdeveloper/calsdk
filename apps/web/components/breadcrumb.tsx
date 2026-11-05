import Link from 'next/link';

export type Crumb = { name: string; path: string };

/**
 * The trail from the home page to the current page. Pages pass the same crumbs to the JSON-LD
 * BreadcrumbList, so the two always match.
 */
export function Breadcrumb({ crumbs, className }: { crumbs: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`breadcrumbs ${className ?? ''}`}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((crumb, i) =>
          i === crumbs.length - 1 ? (
            <li key={crumb.path} aria-current="page" className="text-current">
              {crumb.name}
            </li>
          ) : (
            <li key={crumb.path} className="flex items-center gap-1.5">
              <Link href={crumb.path} className="hover:underline">
                {crumb.name}
              </Link>
              <span aria-hidden>/</span>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
