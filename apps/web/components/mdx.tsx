import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { ProviderLogo, type ProviderLogoId } from './provider-logo';
import { TypeTable } from './type-table';

// Docs tables are tight on phones, where the logo would push the name onto its own line.
function DocsProviderLogo({ id }: { id: ProviderLogoId }) {
  return <ProviderLogo id={id} className="me-1 max-sm:hidden" />;
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    ProviderLogo: DocsProviderLogo,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
