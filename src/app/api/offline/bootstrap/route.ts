import { NextResponse } from 'next/server';

import { getOfflineBootstrap } from '~/server/offline/sync';

export async function GET() {
  try {
    const payload = await getOfflineBootstrap();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Not authenticated' ? 401 : 500;
    return NextResponse.json(
      { error: message || 'Failed to bootstrap offline data' },
      { status },
    );
  }
}
