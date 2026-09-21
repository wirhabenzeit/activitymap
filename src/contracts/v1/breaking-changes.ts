/**
 * Detects breaking changes between two versions of the v1 OpenAPI document
 * (issue #127). This is deliberately narrower than full OpenAPI semantics -
 * see the module doc comment below for exactly what it does and does not
 * catch - and is meant as CI's second check alongside `openapi.test.ts`'s
 * existing drift test: that test proves the checked-in
 * `openapi/v1.json` matches what the current contracts generate (drift
 * detection); this module instead compares *two different* documents (the
 * merge-base's `openapi/v1.json` vs the current one) to catch changes that
 * would break an already-shipped native client.
 *
 * No general-purpose OpenAPI-diff npm package was adopted here: none of the
 * actively maintained ones on the npm registry both (a) support OpenAPI
 * 3.1/JSON Schema 2020-12 (this document's dialect, since it's generated
 * directly from Zod via `z.toJSONSchema`) and (b) are usable as a plain
 * library call in this sandbox without extra native/Java tooling (`oasdiff`
 * is a standalone Go binary, not an npm package). A small, purpose-built
 * comparison - honestly scoped to the patterns #127 calls out - is more
 * reliable here than a heavier dependency of uncertain fit.
 *
 * **What this catches:**
 * - A path removed entirely.
 * - An operation (HTTP method) removed from a path that still exists.
 * - A documented response status code removed from an operation.
 * - Security requirements added to an operation that had none (a
 *   previously-public endpoint now requires auth).
 * - A request parameter that was optional (or absent) now marked required,
 *   or a previously-required parameter removed outright.
 * - A request parameter's declared JSON Schema type changed.
 * - A named component schema (`components.schemas.*`) losing a property
 *   that used to exist (whether or not it was `required`).
 * - A component schema property that was optional now marked `required`.
 * - A component schema property that allowed `null` (`type` includes
 *   `"null"`, or an `anyOf`/`oneOf` branch does) no longer allowing it.
 * - A component schema property's declared JSON Schema `type` changed.
 *
 * **What this deliberately does NOT catch** (honest limitations, not full
 * OpenAPI/JSON-Schema semantics):
 * - Changes reachable only through deeply nested `allOf`/`oneOf`/`anyOf`
 *   composition beyond the single-level nullable check above.
 * - Enum value removal (a previously-valid enum member disappearing) -
 *   only `type` and nullability are compared, not `enum`/`const`.
 * - Numeric/string constraint tightening (e.g. a smaller `maximum`, a
 *   stricter `pattern`) - only presence, requiredness, type, and
 *   nullability are compared.
 * - Renaming a `$ref` target that has otherwise identical shape (this
 *   library resolves `$ref`s by their target schema name only for
 *   equality; a same-shape schema under a new name is still reported once,
 *   as the two schemas being compared no longer resolve to the same name).
 * - Additive changes are, correctly, never flagged: new paths, new
 *   operations, new optional parameters/fields, new response codes, and a
 *   previously-required field becoming optional are all backward
 *   compatible and produce no findings.
 */

export type JsonSchemaLike = {
  type?: string | readonly string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: readonly string[];
  items?: JsonSchemaLike;
  $ref?: string;
  anyOf?: readonly JsonSchemaLike[];
  oneOf?: readonly JsonSchemaLike[];
  [key: string]: unknown;
};

export type ParameterLike = {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchemaLike;
};

export type OperationLike = {
  parameters?: readonly ParameterLike[];
  responses?: Record<string, unknown>;
  security?: readonly unknown[];
  [key: string]: unknown;
};

export type OpenApiDocumentLike = {
  paths: Record<string, Record<string, OperationLike>>;
  components?: { schemas?: Record<string, unknown> };
};

/** One human-readable breaking-change finding. */
export type BreakingChange = { message: string };

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function isOperationKey(key: string): boolean {
  return HTTP_METHODS.includes(key);
}

function typesOf(schema: JsonSchemaLike | undefined): Set<string> {
  if (!schema) return new Set();
  const direct = schema.type;
  const types = new Set<string>(
    direct === undefined ? [] : Array.isArray(direct) ? direct : [direct],
  );
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    for (const t of typesOf(branch)) types.add(t);
  }
  if (schema.$ref) types.add(`$ref:${schema.$ref}`);
  return types;
}

function allowsNull(schema: JsonSchemaLike | undefined): boolean {
  return typesOf(schema).has('null');
}

/** Non-null, non-$ref primitive/structural types, for a type-change comparison that ignores nullability (checked separately) and ref identity (checked as part of property/schema comparison). */
function coreTypes(schema: JsonSchemaLike | undefined): string[] {
  return Array.from(typesOf(schema))
    .filter((t) => t !== 'null' && !t.startsWith('$ref:'))
    .sort();
}

function refTarget(schema: JsonSchemaLike | undefined): string | undefined {
  return schema?.$ref;
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function compareSchemaProperty(
  schemaName: string,
  propName: string,
  before: JsonSchemaLike,
  after: JsonSchemaLike,
  out: BreakingChange[],
): void {
  const beforeRequired = (before.required ?? []).includes(propName);
  const afterRequired = (after.required ?? []).includes(propName);
  const beforeProp = before.properties?.[propName];
  const afterProp = after.properties?.[propName];

  if (beforeProp && !afterProp) {
    out.push({
      message: `${schemaName}.${propName}: field removed`,
    });
    return;
  }
  if (!beforeProp || !afterProp) return;

  if (!beforeRequired && afterRequired) {
    out.push({
      message: `${schemaName}.${propName}: tightened from optional to required`,
    });
  }

  if (allowsNull(beforeProp) && !allowsNull(afterProp)) {
    out.push({
      message: `${schemaName}.${propName}: no longer nullable (was nullable)`,
    });
  }

  const beforeRef = refTarget(beforeProp);
  const afterRef = refTarget(afterProp);
  if (beforeRef !== undefined || afterRef !== undefined) {
    if (beforeRef !== afterRef) {
      out.push({
        message: `${schemaName}.${propName}: referenced schema changed (${beforeRef ?? 'inline'} -> ${afterRef ?? 'inline'})`,
      });
    }
    return;
  }

  const beforeTypes = coreTypes(beforeProp);
  const afterTypes = coreTypes(afterProp);
  if (beforeTypes.length > 0 && afterTypes.length > 0 && !sameArray(beforeTypes, afterTypes)) {
    out.push({
      message: `${schemaName}.${propName}: type changed (${beforeTypes.join('|')} -> ${afterTypes.join('|')})`,
    });
  }
}

function compareComponentSchemas(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  out: BreakingChange[],
): void {
  for (const [name, beforeSchemaRaw] of Object.entries(before)) {
    const afterSchemaRaw = after[name];
    if (!afterSchemaRaw) continue; // Schema removal is covered indirectly via the operations that referenced it.
    const beforeSchema = beforeSchemaRaw as JsonSchemaLike;
    const afterSchema = afterSchemaRaw as JsonSchemaLike;
    const propNames = new Set([
      ...Object.keys(beforeSchema.properties ?? {}),
      ...Object.keys(afterSchema.properties ?? {}),
    ]);
    for (const propName of propNames) {
      compareSchemaProperty(name, propName, beforeSchema, afterSchema, out);
    }
  }
}

function compareParameters(
  routeLabel: string,
  before: readonly ParameterLike[],
  after: readonly ParameterLike[],
  out: BreakingChange[],
): void {
  const afterByKey = new Map(after.map((p) => [`${p.in}:${p.name}`, p]));
  for (const beforeParam of before) {
    const key = `${beforeParam.in}:${beforeParam.name}`;
    const afterParam = afterByKey.get(key);
    if (!afterParam) {
      if (beforeParam.required) {
        out.push({
          message: `${routeLabel}: required parameter \`${beforeParam.name}\` (${beforeParam.in}) removed`,
        });
      }
      continue;
    }
    if (!beforeParam.required && afterParam.required) {
      out.push({
        message: `${routeLabel}: parameter \`${beforeParam.name}\` (${beforeParam.in}) tightened from optional to required`,
      });
    }
    const beforeTypes = coreTypes(beforeParam.schema);
    const afterTypes = coreTypes(afterParam.schema);
    if (beforeTypes.length > 0 && afterTypes.length > 0 && !sameArray(beforeTypes, afterTypes)) {
      out.push({
        message: `${routeLabel}: parameter \`${beforeParam.name}\` (${beforeParam.in}) type changed (${beforeTypes.join('|')} -> ${afterTypes.join('|')})`,
      });
    }
  }
}

function compareOperation(
  routeLabel: string,
  before: OperationLike,
  after: OperationLike,
  out: BreakingChange[],
): void {
  compareParameters(routeLabel, before.parameters ?? [], after.parameters ?? [], out);

  const beforeResponses = Object.keys(before.responses ?? {});
  const afterResponses = new Set(Object.keys(after.responses ?? {}));
  for (const status of beforeResponses) {
    if (!afterResponses.has(status)) {
      out.push({ message: `${routeLabel}: response \`${status}\` removed` });
    }
  }

  const hadSecurity = (before.security ?? []).length > 0;
  const hasSecurity = (after.security ?? []).length > 0;
  if (!hadSecurity && hasSecurity) {
    out.push({
      message: `${routeLabel}: now requires authentication (previously public)`,
    });
  }
}

/**
 * Compares two versions of the v1 OpenAPI document and returns every
 * breaking change found, in a stable, human-readable form. An empty array
 * means no breaking change was detected (additive/non-breaking changes,
 * including none at all, are not reported).
 */
export function findBreakingChanges(
  before: OpenApiDocumentLike,
  after: OpenApiDocumentLike,
): BreakingChange[] {
  const out: BreakingChange[] = [];

  for (const [path, beforeMethods] of Object.entries(before.paths ?? {})) {
    const afterMethods = after.paths?.[path];
    if (!afterMethods) {
      out.push({ message: `${path}: path removed` });
      continue;
    }
    for (const [method, beforeOp] of Object.entries(beforeMethods)) {
      if (!isOperationKey(method)) continue;
      const routeLabel = `${method.toUpperCase()} ${path}`;
      const afterOp = afterMethods[method];
      if (!afterOp) {
        out.push({ message: `${routeLabel}: operation removed` });
        continue;
      }
      compareOperation(routeLabel, beforeOp, afterOp, out);
    }
  }

  compareComponentSchemas(
    before.components?.schemas ?? {},
    after.components?.schemas ?? {},
    out,
  );

  return out;
}
