import { NextResponse } from 'next/server';

import { getOfflineChanges } from '~/server/offline/sync';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since');

  try {
    const payload = await getOfflineChanges(since);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Not authenticated' ? 401 : 500;
    return NextResponse.json(
      { error: message || 'Failed to fetch offline changes' },
      { status },
    );
  }
}
