import type { ComponentProps, ReactNode } from 'react';

export function MapMarkerPin({
  count,
  thumbnails = false,
  children,
  ...props
}: ComponentProps<'span'> & {
  count: number;
  thumbnails?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      {...props}
      className={`relative flex items-center justify-center border-[1.5px] border-white bg-[#262626] text-white shadow-md ${thumbnails ? 'h-9 w-9 rounded-md' : 'h-7 w-7 rounded-full'}`}
    >
      {children}
      {count > 1 && (
        <span className="absolute -top-1 -right-1 min-w-4 rounded-full border border-white bg-[#262626] px-1 text-center text-[9px] leading-4 font-semibold">
          {count}
        </span>
      )}
    </span>
  );
}
