import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import {
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';

/**
 * The sign-in store: the records the app's auth library (Better Auth) keeps,
 * held here as documents. The library addresses a
 * record by model and a list of conditions on its fields, and this file
 * implements exactly that: create, find, count, update and delete.
 *
 * A record is stored whole in `doc`. The few fields the library looks
 * records up by are copied next to it and indexed; a query that names one
 * of them reads through that index and checks the remaining conditions in
 * memory. Anything else reads the model's records, which is fine for the
 * numbers involved (accounts, their sessions, a handful of keys).
 *
 * Only the app reaches this, through the signed auth route (http.ts).
 */

const MODELS = [
  'user',
  'account',
  'session',
  'verification',
  'jwks',
  // The app's own one-time codes for signing in from the iOS app.
  'mobileLoginCode',
] as const;
type Model = (typeof MODELS)[number];
const LOOKUPS = [
  'userId',
  'token',
  'identifier',
  'accountId',
  'email',
] as const;
/** More records than a model can sensibly hold; a query stops here. */
const SCAN_LIMIT = 8192;

const model = v.string();
const condition = v.object({
  field: v.string(),
  value: v.any(),
  operator: v.optional(v.string()),
  connector: v.optional(v.string()),
  mode: v.optional(v.string()),
});
type Condition = {
  field: string;
  value: unknown;
  operator?: string;
  connector?: string;
  mode?: string;
};
type Fields = Record<string, unknown>;

function known(name: string): Model {
  if (!(MODELS as readonly string[]).includes(name))
    throw new Error('Unknown auth model');
  return name as Model;
}

const lower = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : value;

/** One condition against one record, as the auth library defines them. */
function holds(record: Fields, { field, value, operator, mode }: Condition) {
  const insensitive =
    mode === 'insensitive' &&
    (typeof value === 'string' ||
      (Array.isArray(value) &&
        value.every((item) => typeof item === 'string')));
  const actual = insensitive ? lower(record[field]) : record[field];
  const wanted = insensitive
    ? Array.isArray(value)
      ? value.map(lower)
      : lower(value)
    : value;
  const text = (test: (a: string, b: string) => boolean) =>
    typeof actual === 'string' && typeof wanted === 'string'
      ? test(actual, wanted)
      : false;
  const ordered = (
    test: (a: string | number, b: string | number) => boolean,
  ) =>
    wanted !== null &&
    wanted !== undefined &&
    actual !== null &&
    actual !== undefined &&
    typeof actual === typeof wanted &&
    (typeof actual === 'string' || typeof actual === 'number')
      ? test(actual, wanted as string | number)
      : false;
  switch (operator ?? 'eq') {
    case 'in':
      if (!Array.isArray(wanted)) throw new Error('Value must be an array');
      return wanted.includes(actual);
    case 'not_in':
      if (!Array.isArray(wanted)) throw new Error('Value must be an array');
      return !wanted.includes(actual);
    case 'contains':
      return text((a, b) => a.includes(b));
    case 'starts_with':
      return text((a, b) => a.startsWith(b));
    case 'ends_with':
      return text((a, b) => a.endsWith(b));
    case 'ne':
      return wanted === null ? actual != null : actual !== wanted;
    case 'gt':
      return ordered((a, b) => a > b);
    case 'gte':
      return ordered((a, b) => a >= b);
    case 'lt':
      return ordered((a, b) => a < b);
    case 'lte':
      return ordered((a, b) => a <= b);
    case 'eq':
      return wanted === null ? actual == null : actual === wanted;
    default:
      throw new Error('Unknown condition operator');
  }
}

/** All conditions, left to right; a condition's connector joins it to the
 * ones before it. */
function matches(record: Fields, where: Condition[]) {
  if (where.length === 0) return true;
  let result = holds(record, where[0]!);
  for (const clause of where.slice(1)) {
    const next = holds(record, clause);
    result = clause.connector === 'OR' ? result || next : result && next;
  }
  return result;
}

/** The model's records that satisfy `where`, in creation order. */
async function select(ctx: QueryCtx, name: Model, where: Condition[]) {
  const exact = where.every((clause) => clause.connector !== 'OR')
    ? where.filter(
        (clause) =>
          (clause.operator ?? 'eq') === 'eq' &&
          clause.mode !== 'insensitive' &&
          typeof clause.value === 'string',
      )
    : [];
  const byId = exact.find((clause) => clause.field === 'id');
  const byLookup = exact.find((clause) =>
    (LOOKUPS as readonly string[]).includes(clause.field),
  );
  let rows: Doc<'authRecords'>[];
  if (byId)
    rows = await ctx.db
      .query('authRecords')
      .withIndex('by_model_key', (q) =>
        q.eq('model', name).eq('key', byId.value as string),
      )
      .take(1);
  else if (byLookup) {
    const value = byLookup.value as string;
    const records = ctx.db.query('authRecords');
    const indexed =
      byLookup.field === 'userId'
        ? records.withIndex('by_model_userId', (q) =>
            q.eq('model', name).eq('userId', value),
          )
        : byLookup.field === 'token'
          ? records.withIndex('by_model_token', (q) =>
              q.eq('model', name).eq('token', value),
            )
          : byLookup.field === 'identifier'
            ? records.withIndex('by_model_identifier', (q) =>
                q.eq('model', name).eq('identifier', value),
              )
            : byLookup.field === 'accountId'
              ? records.withIndex('by_model_accountId', (q) =>
                  q.eq('model', name).eq('accountId', value),
                )
              : records.withIndex('by_model_email', (q) =>
                  q.eq('model', name).eq('email', value),
                );
    rows = await indexed.take(SCAN_LIMIT);
  } else
    rows = await ctx.db
      .query('authRecords')
      .withIndex('by_model_key', (q) => q.eq('model', name))
      .take(SCAN_LIMIT);
  return rows.filter((row) => matches(row.doc as Fields, where));
}

function stored(name: Model, doc: Fields) {
  if (typeof doc.id !== 'string' || !doc.id || doc.id.length > 256)
    throw new Error('An auth record needs a string id');
  const lookups: Partial<Record<(typeof LOOKUPS)[number], string>> = {};
  for (const field of LOOKUPS) {
    const value = doc[field];
    if (typeof value === 'string') lookups[field] = value;
  }
  return { model: name, key: doc.id, doc, ...lookups };
}

const picked = (doc: Fields, fields?: string[]) =>
  fields?.length
    ? Object.fromEntries(
        Object.entries(doc).filter(([field]) => fields.includes(field)),
      )
    : doc;

export const find = internalQuery({
  args: {
    model,
    where: v.optional(v.array(condition)),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    sortBy: v.optional(v.object({ field: v.string(), direction: v.string() })),
    select: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Fields[]> => {
    const rows = await select(ctx, known(args.model), args.where ?? []);
    const docs = rows.map((row) => row.doc as Fields);
    if (args.sortBy) {
      const { field, direction } = args.sortBy;
      const order = direction === 'desc' ? -1 : 1;
      docs.sort((a, b) => {
        const left = a[field];
        const right = b[field];
        if (left == null || right == null)
          return order * (left == null ? (right == null ? 0 : -1) : 1);
        if (typeof left === 'number' && typeof right === 'number')
          return order * (left - right);
        return order * String(left).localeCompare(String(right));
      });
    }
    const offset = Math.max(0, args.offset ?? 0);
    const limit = args.limit ?? docs.length;
    return docs
      .slice(offset, offset + Math.max(0, limit))
      .map((doc) => picked(doc, args.select));
  },
});

export const count = internalQuery({
  args: { model, where: v.optional(v.array(condition)) },
  handler: async (ctx, args): Promise<number> =>
    (await select(ctx, known(args.model), args.where ?? [])).length,
});

export const create = internalMutation({
  args: { model, data: v.any() },
  handler: async (ctx, args): Promise<Fields> => {
    const name = known(args.model);
    const record = stored(name, args.data as Fields);
    const taken = await ctx.db
      .query('authRecords')
      .withIndex('by_model_key', (q) =>
        q.eq('model', name).eq('key', record.key),
      )
      .unique();
    if (taken) throw new Error('An auth record with this id exists');
    await ctx.db.insert('authRecords', record);
    return record.doc;
  },
});

/** Change the first matching record (its new state, or null), or with
 * `many` every matching record (how many). */
export const update = internalMutation({
  args: {
    model,
    where: v.array(condition),
    update: v.any(),
    many: v.optional(v.boolean()),
    /** `before`: answer the one record as it was before the change. */
    returning: v.optional(v.literal('before')),
  },
  handler: async (ctx, args): Promise<Fields | number | null> => {
    const name = known(args.model);
    const rows = await select(ctx, name, args.where);
    const targets = args.many ? rows : rows.slice(0, 1);
    let last: Fields | null = null;
    for (const row of targets) {
      // The id is a record's identity and never changes.
      const next = { ...(row.doc as Fields), ...(args.update as Fields) };
      next.id = (row.doc as Fields).id;
      await ctx.db.replace('authRecords', row._id, stored(name, next));
      last = args.returning === 'before' ? (row.doc as Fields) : next;
    }
    return args.many ? targets.length : last;
  },
});

/** Delete the first matching record, or with `many` every matching record.
 * Answers how many, or with `consume` the one record that was deleted. */
export const remove = internalMutation({
  args: {
    model,
    where: v.array(condition),
    many: v.optional(v.boolean()),
    consume: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Fields | number | null> => {
    const rows = await select(ctx, known(args.model), args.where);
    const targets = args.many ? rows : rows.slice(0, 1);
    for (const row of targets) await ctx.db.delete('authRecords', row._id);
    if (args.consume) return (targets[0]?.doc as Fields | undefined) ?? null;
    return targets.length;
  },
});
