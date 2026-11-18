import { Globe } from 'lucide-react';

/** Inline SVG flags: flag emoji render as letter pairs on Windows. */
const flags: Record<string, React.ReactNode> = {
  CH: (
    <svg viewBox="0 0 32 32">
      <rect width="32" height="32" fill="#DA291C" />
      <rect x="13" y="6" width="6" height="20" fill="#fff" />
      <rect x="6" y="13" width="20" height="6" fill="#fff" />
    </svg>
  ),
  NO: (
    <svg viewBox="0 0 22 16" preserveAspectRatio="xMidYMid slice">
      <rect width="22" height="16" fill="#BA0C2F" />
      <rect x="6" width="4" height="16" fill="#fff" />
      <rect y="6" width="22" height="4" fill="#fff" />
      <rect x="7" width="2" height="16" fill="#00205B" />
      <rect y="7" width="22" height="2" fill="#00205B" />
    </svg>
  ),
};

/** 16px region icon: the country's flag, or a globe for worldwide groups. */
export function RegionIcon({ country }: { country?: string }) {
  const flag = country ? flags[country] : undefined;
  if (!flag) return <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/10 [&>svg]:h-full [&>svg]:w-full"
    >
      {flag}
    </span>
  );
}
