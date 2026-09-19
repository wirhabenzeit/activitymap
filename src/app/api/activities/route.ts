import { getActivitiesByIds } from '~/server/db/actions';
import { NextResponse } from 'next/server';
import { logger } from '~/server/logging/logger';
import { toActivityDTO, activityDTOSchema } from '~/contracts/v1/activity';
import { responseEnvelope, makeEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelope } from '~/contracts/v1/error';
import { z } from 'zod';

/**
 * A v1 contract boundary example (see issue #119): the response is the
 * versioned DTO envelope, never the raw Drizzle `Activity` row, and both
 * the success and error shapes are validated before being sent.
 */
const responseSchema = responseEnvelope(
  z.object({ items: z.array(activityDTOSchema) }),
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = searchParams.get('ids');

  if (!ids) {
    return NextResponse.json(errorEnvelope('validation_failed', 'No IDs provided'), {
      status: 400,
    });
  }

  const parsedIds = ids.split(',').map(Number);
  if (parsedIds.some((id) => !Number.isFinite(id))) {
    return NextResponse.json(
      errorEnvelope('validation_failed', 'IDs must be a comma-separated list of numbers'),
      { status: 400 },
    );
  }

  try {
    const activities = await getActivitiesByIds(parsedIds);
    const body = responseSchema.parse(
      makeEnvelope({ items: activities.map(toActivityDTO) }),
    );
    return NextResponse.json(body);
  } catch (error) {
    logger.error('Error fetching activities:', error);
    return NextResponse.json(
      errorEnvelope('internal_error', 'Failed to fetch activities'),
      { status: 500 },
    );
  }
}
