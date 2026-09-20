import { NextResponse } from 'next/server';

import { requireActor, UnauthenticatedError } from '~/server/auth/actor';
import { getOfflineBootstrap } from '~/server/application/sync';

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const payload = await getOfflineBootstrap(actor);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message || 'Failed to bootstrap offline data' },
      { status: 500 },
    );
  }
}
