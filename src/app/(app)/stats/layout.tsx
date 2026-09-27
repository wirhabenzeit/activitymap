import { type ReactNode } from 'react';

export default function StatsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="h-full min-h-0 w-full"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {children}
    </div>
  );
}
