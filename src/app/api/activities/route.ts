import { NextResponse } from 'next/server';

import { getActivitiesForActor } from '~/server/application/activities';
import { requireActor, UnauthenticatedError } from '~/server/auth/actor';
import { logger } from '~/server/logging/logger';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = searchParams.get('ids');

  if (!ids) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
  }

  try {
    const actor = await requireActor(request.headers);
    const activities = await getActivitiesForActor(
      actor,
      ids.split(',').map(Number),
    );

    return NextResponse.json(
      activities.map((activity) => ({
        id: activity.id,
        public_id: activity.public_id,
      })),
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error('Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 },
    );
  }
}
