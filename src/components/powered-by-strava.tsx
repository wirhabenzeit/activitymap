import Image from 'next/image';

import { message } from '~/lib/presentation/messages';
import { cn } from '~/lib/utils';

/**
 * Strava's official "Powered by Strava" artwork, unmodified (issue #587).
 * Strava's brand guidelines allow it near, but separate from and no more
 * prominent than, the application's own name. The orange logo is for light
 * surfaces and the white one for dark, so both ship and the theme picks one.
 * The native height keeps it small beside the app name; the intrinsic ratio
 * is 365 x 37, so only the height is set.
 */
export function PoweredByStrava({ className }: { className?: string }) {
  const alt = message('connect.poweredByStrava');
  return (
    <span className={cn('inline-flex', className)}>
      <Image
        src="/api_logo_pwrdBy_strava_horiz_orange.svg"
        alt={alt}
        width={365}
        height={37}
        unoptimized
        className="h-4 w-auto dark:hidden"
      />
      <Image
        src="/api_logo_pwrdBy_strava_horiz_white.svg"
        alt={alt}
        width={365}
        height={37}
        unoptimized
        className="hidden h-4 w-auto dark:block"
      />
    </span>
  );
}
