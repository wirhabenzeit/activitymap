import { z } from 'zod';

const day = z.iso.date();
const metric = z.enum(['count', 'distance', 'elevation', 'time']);
const threshold = z
  .object({ operator: z.enum(['>=', '<=']), value: z.number() })
  .strict();
export const statsParitySchema = z
  .object({
    version: z.literal(1),
    tolerance: z.literal(0.000001),
    fixtures: z
      .array(
        z
          .object({
            id: z.string().min(1),
            description: z.string().min(1),
            today: day,
            activities: z.array(
              z
                .object({
                  id: z.number().int(),
                  sportType: z.string().min(1),
                  startDateLocal: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
                  distance: z.number().nonnegative().nullable(),
                  movingTime: z.number().nonnegative().nullable(),
                  elevationGain: z.number().nonnegative().nullable(),
                  name: z.string().optional(),
                  elapsedTime: z.number().nonnegative().nullable().optional(),
                  commute: z.boolean().nullable().optional(),
                  private: z.boolean().nullable().optional(),
                  flagged: z.boolean().nullable().optional(),
                })
                .strict(),
            ),
            cases: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    operation: z.enum([
                      'totals',
                      'yearToDate',
                      'monthVsLastMonth',
                      'thisWeek',
                      'typicalWeek',
                      'yearPace',
                      'activityCalendar',
                      'records',
                      'best30Days',
                      'sportMix',
                      'consistency',
                      'restDays',
                      'weeklyActiveDays',
                      'dailyTotals',
                      'calendarDays',
                      'calendarMonths',
                      'cumulativeByDay',
                      'cumulativeYearPoints',
                      'volumeHistory',
                      'filterActivities',
                      'localToday',
                    ]),
                    args: z
                      .object({
                        today: day.optional(),
                        metric: metric.optional(),
                        first: day.optional(),
                        last: day.optional(),
                        year: z.number().int().optional(),
                        weeks: z
                          .union([z.literal(12), z.literal(52)])
                          .optional(),
                        range: z
                          .enum([
                            'currentYear',
                            'allTime',
                            'weeks',
                            'months',
                            'years',
                          ])
                          .optional(),
                        page: z.number().int().nonnegative().optional(),
                        now: z.iso.datetime({ offset: true }).optional(),
                        timeZone: z.string().optional(),
                        filter: z
                          .object({
                            sportTypes: z.array(z.string()).optional(),
                            search: z.string().optional(),
                            dateRange: z
                              .object({ start: day, end: day })
                              .strict()
                              .optional(),
                            numeric: z
                              .object({
                                distance: threshold.optional(),
                                total_elevation_gain: threshold.optional(),
                                elapsed_time: threshold.optional(),
                              })
                              .strict()
                              .optional(),
                            binary: z
                              .object({
                                commute: z
                                  .enum(['any', 'yes', 'no'])
                                  .optional(),
                                private: z
                                  .enum(['any', 'yes', 'no'])
                                  .optional(),
                                flagged: z
                                  .enum(['any', 'yes', 'no'])
                                  .optional(),
                              })
                              .strict()
                              .optional(),
                          })
                          .strict()
                          .optional(),
                      })
                      .strict(),
                    expected: z.json(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((corpus, context) => {
    const ids = new Set<string>();
    for (const fixture of corpus.fixtures) {
      if (ids.has(fixture.id))
        context.addIssue({
          code: 'custom',
          message: `Duplicate fixture ${fixture.id}`,
        });
      ids.add(fixture.id);
      if (
        new Set(fixture.activities.map((a) => a.id)).size !==
        fixture.activities.length
      )
        context.addIssue({
          code: 'custom',
          message: `Duplicate activity in ${fixture.id}`,
        });
      if (new Set(fixture.cases.map((c) => c.id)).size !== fixture.cases.length)
        context.addIssue({
          code: 'custom',
          message: `Duplicate case in ${fixture.id}`,
        });
      for (const vector of fixture.cases) {
        const required =
          vector.operation === 'cumulativeYearPoints'
            ? (['year'] as const)
            : vector.operation === 'localToday'
              ? (['now', 'timeZone'] as const)
              : [];
        for (const argument of required) {
          if (vector.args[argument] === undefined)
            context.addIssue({
              code: 'custom',
              message: `${fixture.id}/${vector.id} requires ${argument}`,
            });
        }
        const ranges =
          vector.operation === 'volumeHistory'
            ? ['weeks', 'months', 'years']
            : vector.operation === 'records' || vector.operation === 'sportMix'
              ? ['currentYear', 'allTime']
              : null;
        if (ranges && vector.args.range && !ranges.includes(vector.args.range))
          context.addIssue({
            code: 'custom',
            message: `Invalid range in ${fixture.id}/${vector.id}`,
          });
      }
    }
  });

export const statsCapabilitiesSchema = z
  .object({
    version: z.literal(1),
    baseline: z.string().regex(/^[a-f0-9]{40}$/),
    tiles: z
      .array(
        z
          .object({
            id: z.string(),
            group: z.string(),
            visibility: z.enum([
              'visible',
              'inRecords',
              'notRendered',
              'unspecified',
            ]),
            expandable: z.boolean(),
            options: z.array(z.string()),
            defaultOption: z.string().nullable(),
            compact: z.string().min(1),
            expanded: z.string().min(1),
            nativeOwner: z.number().int(),
            uiOwner: z.literal(265),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
