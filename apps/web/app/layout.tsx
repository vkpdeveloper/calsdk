import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Archivo, Source_Code_Pro } from 'next/font/google';
import { appDescription, appName, siteUrl } from '@/lib/shared';
import './global.css';

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' });
const sourceCodePro = Source_Code_Pro({ subsets: ['latin'], variable: '--font-source-code-pro' });

// Defaults for pages without their own metadata, such as the 404 page.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: appName, template: `%s | ${appName}` },
  description: appDescription,
  applicationName: appName,
  openGraph: { siteName: appName, type: 'website', locale: 'en_US' },
  twitter: { card: 'summary_large_image' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`dark ${archivo.variable} ${sourceCodePro.variable} font-sans`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ forcedTheme: 'dark', defaultTheme: 'dark', enableSystem: false }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
