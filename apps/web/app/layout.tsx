import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Archivo, Source_Code_Pro } from 'next/font/google';
import './global.css';

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' });
const sourceCodePro = Source_Code_Pro({ subsets: ['latin'], variable: '--font-source-code-pro' });

export const metadata: Metadata = {
  title: { default: 'calsdk', template: '%s | calsdk' },
  description:
    'One TypeScript API for Google Calendar, Outlook, iCloud, Zoom, Cal.com, Calendly and any CalDAV server.',
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
