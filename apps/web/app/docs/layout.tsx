import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  const { nav, ...base } = baseOptions();
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...base}
      // The top bar already says where you are; a lone "Docs" link only repeats it.
      links={[]}
      nav={{ ...nav, mode: 'top' }}
      // In top mode the collapse button sits at the far right, away from the sidebar it toggles.
      sidebar={{ collapsible: false }}
    >
      {children}
    </DocsLayout>
  );
}
