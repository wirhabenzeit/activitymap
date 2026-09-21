/**
 * Focused OpenAPI compatibility checks for the v1 native-client contract.
 *
 * The important distinction is variance: tightening accepted request input
 * breaks existing callers, while loosening a response breaks existing
 * consumers. Component schemas are therefore classified from their actual
 * request/response references before requiredness and nullability are
 * compared. This is intentionally narrower than a complete OpenAPI 3.1 / JSON
 * Schema 2020-12 implementation; enum and constraint changes, discriminator
 * semantics, and arbitrarily deep composition still require review.
 */

export type JsonSchemaLike = {
  type?: string | readonly string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: readonly string[];
  items?: JsonSchemaLike;
  $ref?: string;
  allOf?: readonly JsonSchemaLike[];
  anyOf?: readonly JsonSchemaLike[];
  oneOf?: readonly JsonSchemaLike[];
  additionalProperties?: boolean | JsonSchemaLike;
  [key: string]: unknown;
};

type MediaTypeLike = { schema?: JsonSchemaLike };
type ContentLike = Record<string, MediaTypeLike>;
type RequestBodyLike = { required?: boolean; content?: ContentLike };
type ResponseLike = { content?: ContentLike; [key: string]: unknown };

export type ParameterLike = {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchemaLike;
};

export type OperationLike = {
  parameters?: readonly ParameterLike[];
  requestBody?: RequestBodyLike;
  responses?: Record<string, ResponseLike>;
  security?: readonly unknown[];
  [key: string]: unknown;
};

export type OpenApiDocumentLike = {
  paths: Record<string, Record<string, OperationLike>>;
  components?: { schemas?: Record<string, JsonSchemaLike> };
};

export type BreakingChange = { message: string };

type SchemaUsage = 'request' | 'response';
type SchemaUsageMap = Map<string, Set<SchemaUsage>>;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const COMPONENT_SCHEMA_PREFIX = '#/components/schemas/';

function isOperationKey(key: string): boolean {
  return HTTP_METHODS.includes(key);
}

function componentNameForRef(ref: string | undefined): string | undefined {
  if (!ref?.startsWith(COMPONENT_SCHEMA_PREFIX)) return undefined;
  return decodeURIComponent(ref.slice(COMPONENT_SCHEMA_PREFIX.length));
}

function typesOf(schema: JsonSchemaLike | undefined): Set<string> {
  if (!schema) return new Set();
  const direct = schema.type;
  const types = new Set<string>(
    direct === undefined ? [] : Array.isArray(direct) ? direct : [direct],
  );
  for (const branch of [
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
  ]) {
    for (const type of typesOf(branch)) types.add(type);
  }
  return types;
}

function allowsNull(schema: JsonSchemaLike | undefined): boolean {
  return typesOf(schema).has('null');
}

function coreTypes(schema: JsonSchemaLike | undefined): string[] {
  return Array.from(typesOf(schema))
    .filter((type) => type !== 'null')
    .sort();
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function schemasInContent(content: ContentLike | undefined): JsonSchemaLike[] {
  return Object.values(content ?? {}).flatMap((mediaType) =>
    mediaType.schema ? [mediaType.schema] : [],
  );
}

function collectSchemaUsage(
  schema: JsonSchemaLike | undefined,
  usage: SchemaUsage,
  schemas: Record<string, JsonSchemaLike>,
  usages: SchemaUsageMap,
  visited: Set<string>,
): void {
  if (!schema) return;

  const componentName = componentNameForRef(schema.$ref);
  if (componentName) {
    const existing = usages.get(componentName) ?? new Set<SchemaUsage>();
    existing.add(usage);
    usages.set(componentName, existing);

    const visitKey = `${usage}:${componentName}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    collectSchemaUsage(schemas[componentName], usage, schemas, usages, visited);
    return;
  }

  for (const property of Object.values(schema.properties ?? {})) {
    collectSchemaUsage(property, usage, schemas, usages, visited);
  }
  collectSchemaUsage(schema.items, usage, schemas, usages, visited);
  for (const branch of [
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
  ]) {
    collectSchemaUsage(branch, usage, schemas, usages, visited);
  }
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object'
  ) {
    collectSchemaUsage(
      schema.additionalProperties,
      usage,
      schemas,
      usages,
      visited,
    );
  }
}

function collectDocumentSchemaUsages(document: OpenApiDocumentLike): SchemaUsageMap {
  const schemas = document.components?.schemas ?? {};
  const usages: SchemaUsageMap = new Map();
  const visited = new Set<string>();

  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isOperationKey(method)) continue;
      for (const parameter of operation.parameters ?? []) {
        collectSchemaUsage(parameter.schema, 'request', schemas, usages, visited);
      }
      for (const schema of schemasInContent(operation.requestBody?.content)) {
        collectSchemaUsage(schema, 'request', schemas, usages, visited);
      }
      for (const response of Object.values(operation.responses ?? {})) {
        for (const schema of schemasInContent(response.content)) {
          collectSchemaUsage(schema, 'response', schemas, usages, visited);
        }
      }
    }
  }
  return usages;
}

function compareSchemaContract(
  label: string,
  before: JsonSchemaLike | undefined,
  after: JsonSchemaLike | undefined,
  usage: SchemaUsage,
  out: BreakingChange[],
): void {
  if (!before || !after) return;

  if (before.$ref !== after.$ref && (before.$ref || after.$ref)) {
    out.push({
      message: `${label}: referenced schema changed (${before.$ref ?? 'inline'} -> ${after.$ref ?? 'inline'})`,
    });
    return;
  }

  const beforeTypes = coreTypes(before);
  const afterTypes = coreTypes(after);
  if (
    beforeTypes.length > 0 &&
    afterTypes.length > 0 &&
    !sameArray(beforeTypes, afterTypes)
  ) {
    out.push({
      message: `${label}: type changed (${beforeTypes.join('|')} -> ${afterTypes.join('|')})`,
    });
  }

  const beforeNullable = allowsNull(before);
  const afterNullable = allowsNull(after);
  if (usage === 'request' && beforeNullable && !afterNullable) {
    out.push({ message: `${label}: request input no longer accepts null` });
  }
  if (usage === 'response' && !beforeNullable && afterNullable) {
    out.push({ message: `${label}: response output may now be null` });
  }
}

function compareSchemaProperty(
  schemaName: string,
  propertyName: string,
  before: JsonSchemaLike,
  after: JsonSchemaLike,
  usages: ReadonlySet<SchemaUsage>,
  out: BreakingChange[],
): void {
  const beforeRequired = (before.required ?? []).includes(propertyName);
  const afterRequired = (after.required ?? []).includes(propertyName);
  const beforeProperty = before.properties?.[propertyName];
  const afterProperty = after.properties?.[propertyName];
  const label = `${schemaName}.${propertyName}`;

  if (beforeProperty && !afterProperty) {
    out.push({ message: `${label}: field removed` });
    return;
  }
  if (!beforeProperty && afterProperty) {
    if (usages.has('request') && afterRequired) {
      out.push({ message: `${label}: new required request field` });
    }
    return;
  }
  if (!beforeProperty || !afterProperty) return;

  if (usages.has('request') && !beforeRequired && afterRequired) {
    out.push({ message: `${label}: request field tightened from optional to required` });
  }
  if (usages.has('response') && beforeRequired && !afterRequired) {
    out.push({ message: `${label}: response field loosened from required to optional` });
  }

  for (const usage of usages) {
    compareSchemaContract(label, beforeProperty, afterProperty, usage, out);
  }
}

function compareComponentSchemas(
  before: Record<string, JsonSchemaLike>,
  after: Record<string, JsonSchemaLike>,
  usages: SchemaUsageMap,
  out: BreakingChange[],
): void {
  for (const [name, beforeSchema] of Object.entries(before)) {
    const componentUsages = usages.get(name);
    if (!componentUsages || componentUsages.size === 0) continue;

    const afterSchema = after[name];
    if (!afterSchema) {
      out.push({ message: `${name}: referenced component schema removed` });
      continue;
    }

    const propertyNames = new Set([
      ...Object.keys(beforeSchema.properties ?? {}),
      ...Object.keys(afterSchema.properties ?? {}),
    ]);
    for (const propertyName of propertyNames) {
      compareSchemaProperty(
        name,
        propertyName,
        beforeSchema,
        afterSchema,
        componentUsages,
        out,
      );
    }
  }
}

function compareParameters(
  routeLabel: string,
  before: readonly ParameterLike[],
  after: readonly ParameterLike[],
  out: BreakingChange[],
): void {
  const beforeByKey = new Map(before.map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]));
  const afterByKey = new Map(after.map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]));

  for (const [key, beforeParameter] of beforeByKey) {
    const afterParameter = afterByKey.get(key);
    if (!afterParameter) {
      out.push({
        message: `${routeLabel}: parameter \`${beforeParameter.name}\` (${beforeParameter.in}) removed`,
      });
      continue;
    }
    if (!beforeParameter.required && afterParameter.required) {
      out.push({
        message: `${routeLabel}: parameter \`${beforeParameter.name}\` (${beforeParameter.in}) tightened from optional to required`,
      });
    }
    compareSchemaContract(
      `${routeLabel}: parameter \`${beforeParameter.name}\` (${beforeParameter.in})`,
      beforeParameter.schema,
      afterParameter.schema,
      'request',
      out,
    );
  }

  for (const [key, afterParameter] of afterByKey) {
    if (!beforeByKey.has(key) && afterParameter.required) {
      out.push({
        message: `${routeLabel}: new required parameter \`${afterParameter.name}\` (${afterParameter.in})`,
      });
    }
  }
}

function compareContent(
  label: string,
  before: ContentLike | undefined,
  after: ContentLike | undefined,
  usage: SchemaUsage,
  out: BreakingChange[],
): void {
  for (const [mediaType, beforeMedia] of Object.entries(before ?? {})) {
    const afterMedia = after?.[mediaType];
    if (!afterMedia) {
      out.push({ message: `${label}: media type \`${mediaType}\` removed` });
      continue;
    }
    if (beforeMedia.schema && !afterMedia.schema) {
      out.push({ message: `${label}: schema for \`${mediaType}\` removed` });
      continue;
    }
    compareSchemaContract(
      `${label} (${mediaType})`,
      beforeMedia.schema,
      afterMedia.schema,
      usage,
      out,
    );
  }
}

function compareOperation(
  routeLabel: string,
  before: OperationLike,
  after: OperationLike,
  out: BreakingChange[],
): void {
  compareParameters(routeLabel, before.parameters ?? [], after.parameters ?? [], out);

  const beforeBody = before.requestBody;
  const afterBody = after.requestBody;
  if (!beforeBody && afterBody?.required) {
    out.push({ message: `${routeLabel}: now requires a request body` });
  } else if (beforeBody && !afterBody) {
    out.push({ message: `${routeLabel}: request body removed` });
  } else if (beforeBody && afterBody) {
    if (!beforeBody.required && afterBody.required) {
      out.push({ message: `${routeLabel}: request body tightened from optional to required` });
    }
    compareContent(
      `${routeLabel}: request body`,
      beforeBody.content,
      afterBody.content,
      'request',
      out,
    );
  }

  const afterResponses = after.responses ?? {};
  for (const [status, beforeResponse] of Object.entries(before.responses ?? {})) {
    const afterResponse = afterResponses[status];
    if (!afterResponse) {
      out.push({ message: `${routeLabel}: response \`${status}\` removed` });
      continue;
    }
    compareContent(
      `${routeLabel}: response \`${status}\``,
      beforeResponse.content,
      afterResponse.content,
      'response',
      out,
    );
  }

  const hadSecurity = (before.security ?? []).length > 0;
  const hasSecurity = (after.security ?? []).length > 0;
  if (!hadSecurity && hasSecurity) {
    out.push({
      message: `${routeLabel}: now requires authentication (previously public)`,
    });
  }
}

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
    for (const [method, beforeOperation] of Object.entries(beforeMethods)) {
      if (!isOperationKey(method)) continue;
      const routeLabel = `${method.toUpperCase()} ${path}`;
      const afterOperation = afterMethods[method];
      if (!afterOperation) {
        out.push({ message: `${routeLabel}: operation removed` });
        continue;
      }
      compareOperation(routeLabel, beforeOperation, afterOperation, out);
    }
  }

  compareComponentSchemas(
    before.components?.schemas ?? {},
    after.components?.schemas ?? {},
    collectDocumentSchemaUsages(before),
    out,
  );

  return out;
}
