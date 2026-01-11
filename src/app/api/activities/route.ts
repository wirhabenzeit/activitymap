import { getActivitiesByIds } from '~/server/db/actions';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = searchParams.get('ids');

  if (!ids) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
  }

  try {
    const activities = await getActivitiesByIds(ids.split(',').map(Number));

    return NextResponse.json(
      activities.map((activity) => ({
        id: activity.id,
        public_id: activity.public_id,
      })),
    );
  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 },
    );
  }
}
