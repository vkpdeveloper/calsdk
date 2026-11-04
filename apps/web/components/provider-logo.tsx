import { Calendar, FlaskConical, type LucideIcon, Rss } from 'lucide-react';
import Image from 'next/image';

// Official marks, served from public/providers. Zoom only publishes its square app icon as a
// PNG. CalDAV, ICS feeds and the mock have no brand, so they get a plain icon.
const LOGOS = {
  google: '/providers/google.svg',
  microsoft: '/providers/outlook.svg',
  icloud: '/providers/icloud.svg',
  zoho: '/providers/zoho.svg',
  caldav: Calendar,
  zoom: '/providers/zoom.png',
  calcom: '/providers/calcom.svg',
  calendly: '/providers/calendly.svg',
  ics: Rss,
  mock: FlaskConical,
} satisfies Record<string, string | LucideIcon>;

export type ProviderLogoId = keyof typeof LOGOS;

/**
 * A provider's mark on a small light tile, so dark marks stay visible on the dark site.
 * Decorative: the provider's name always sits next to it.
 */
export function ProviderLogo({ id, className = '' }: { id: ProviderLogoId; className?: string }) {
  const Logo = LOGOS[id];
  return (
    <span
      aria-hidden
      className={`inline-flex size-5 shrink-0 items-center justify-center align-middle rounded-[5px] bg-white ${className}`}
    >
      {typeof Logo === 'string' ? (
        // Unoptimized: the marks are SVGs, plus one small PNG, that need no resizing.
        <Image
          src={Logo}
          alt=""
          width={14}
          height={14}
          unoptimized
          className="size-3.5 object-contain"
        />
      ) : (
        <Logo className="size-3.5 text-neutral-700" strokeWidth={2.25} />
      )}
    </span>
  );
}
