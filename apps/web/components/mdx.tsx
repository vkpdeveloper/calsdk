import Link from 'fumadocs-core/link';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { CodeBlockTab } from 'fumadocs-ui/components/codeblock';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps, ReactNode } from 'react';
import { ProviderLogo, type ProviderLogoId } from './provider-logo';
import { TypeTable } from './type-table';

// Docs tables are tight on phones, where the logo would push the name onto its own line.
function DocsProviderLogo({ id }: { id: ProviderLogoId }) {
  return <ProviderLogo id={id} className="me-1 max-sm:hidden" />;
}

// Hidden tabs stay in the HTML, so crawlers and AI tools that don't run JavaScript read every
// provider's example, not only the first.
function KeptTab(props: ComponentProps<typeof Tab>) {
  return <Tab keepMounted {...props} />;
}

function KeptCodeBlockTab(props: ComponentProps<typeof CodeBlockTab>) {
  return <CodeBlockTab keepMounted {...props} />;
}

// Fumadocs' headings carry a `scroll-m-28` class, and Readability, which many AI tools use to
// pull the article out of a page, drops any heading whose class contains "scroll". These keep
// the anchor link and set the scroll margin in global.css instead.
function anchored(As: 'h2' | 'h3' | 'h4') {
  return function Heading({ id, children, className, ...props }: ComponentProps<'h2'>) {
    if (!id) return <As {...props}>{children}</As>;
    return (
      <As id={id} className={`flex flex-row items-center gap-1 ${className ?? ''}`} {...props}>
        <a data-card href={`#${id}`}>
          {children}
        </a>
      </As>
    );
  };
}

// Fumadocs' Card titles are bare <h3>s, which crowd the page outline with links. A card is a
// link, so its title is plain text here.
function Card({ title, href, children }: { title: ReactNode; href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      data-card
      className="block rounded-xl border bg-fd-card p-4 text-fd-card-foreground transition-colors hover:bg-fd-accent/80 @max-lg:col-span-full"
    >
      <div className="not-prose mb-1 text-sm font-medium">{title}</div>
      <div className="text-sm text-fd-muted-foreground prose-no-margin empty:hidden">
        {children}
      </div>
    </Link>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Card,
    CodeBlockTab: KeptCodeBlockTab,
    h2: anchored('h2'),
    h3: anchored('h3'),
    h4: anchored('h4'),
    ProviderLogo: DocsProviderLogo,
    Step,
    Steps,
    Tab: KeptTab,
    Tabs,
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
