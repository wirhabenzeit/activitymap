import { NextResponse } from 'next/server';

import { requireActor, UnauthenticatedError } from '~/server/auth/actor';
import { getOfflineChanges } from '~/server/application/sync';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since');

  try {
    const actor = await requireActor(request.headers);
    const payload = await getOfflineChanges(actor, since);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message || 'Failed to fetch offline changes' },
      { status: 500 },
    );
  }
}
