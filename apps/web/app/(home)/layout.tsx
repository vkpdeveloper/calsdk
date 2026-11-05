import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { HomeContainer } from '@/components/home-container';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <HomeLayout {...baseOptions()} slots={{ container: HomeContainer }}>
      <main className="flex flex-1 flex-col">{children}</main>
    </HomeLayout>
  );
}
