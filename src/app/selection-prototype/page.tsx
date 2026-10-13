import { notFound } from 'next/navigation';
import SelectionPreview from './preview';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ device?: string }>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { device } = await searchParams;
  if (device === 'phone') {
    return (
      <div className="flex h-dvh flex-col items-center gap-3 bg-muted px-4 py-3">
        <div className="flex w-full max-w-[390px] items-center justify-between gap-2 text-sm">
          <span className="font-semibold">Selection · mobile prototype</span>
          <a className="underline" href="/selection-prototype">
            Full size
          </a>
        </div>
        <iframe
          title="ActivityMap mobile selection prototype"
          src="/selection-prototype"
          className="min-h-0 w-full max-w-[390px] flex-1 rounded-2xl border-4 border-slate-800 bg-background shadow-xl"
        />
        <p className="max-w-[390px] text-center text-xs text-muted-foreground">
          Try Only selected in Filters. Use the selection icon in the Map header
          or List footer, then tap sport icons to add or remove activities.
        </p>
      </div>
    );
  }
  return <SelectionPreview />;
}
