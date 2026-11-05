import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { booking } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  title: `${booking.title} with ${booking.owner}`,
  description: `Book a ${booking.duration}-minute ${booking.title.toLowerCase()} with ${booking.owner}.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
