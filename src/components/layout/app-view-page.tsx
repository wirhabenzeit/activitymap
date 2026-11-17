'use client';

import { useAppViewPage } from '~/lib/app-views';

/**
 * The whole content of the `/map`, `/list` and `/stats/tiles` route pages:
 * `AppViews` in the app shell renders the view itself. Mounting this tells
 * `navigateToView` it may switch between views without a server request.
 */
export function AppViewPage() {
  useAppViewPage();
  return null;
}
