import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOpenApiDocument } from './openapi.ts';
import {
  findBreakingChanges,
  type JsonSchemaLike,
  type OpenApiDocumentLike,
  type OperationLike,
  type ParameterLike,
} from './breaking-changes.ts';

/**
 * Builds a fresh, mutable fixture document for one test, returning both the
 * document and direct references to its mutable parts - so a test mutates
 * `cursorParam`/`getOperation`/`widgetSchema` directly instead of
 * re-indexing into `doc.paths[...]`, which under this project's
 * `noUncheckedIndexedAccess` would otherwise require an assertion at every
 * access.
 */
function fixture() {
  const cursorParam: ParameterLike = {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  };
  const parameters: ParameterLike[] = [cursorParam];
  const getOperation: OperationLike = {
    parameters,
    responses: {
      '200': {
        description: 'ok',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Widget' },
          },
        },
      },
      '400': { description: 'bad request' },
    },
    security: [{ cookieAuth: [] }],
  };
  const widgetSchema: JsonSchemaLike = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      note: { type: ['string', 'null'] },
    },
    required: ['id'],
  };
  const doc: OpenApiDocumentLike = {
    paths: { '/api/v1/widgets': { get: getOperation } },
    components: { schemas: { Widget: widgetSchema } },
  };
  return { doc, getOperation, parameters, widgetSchema, cursorParam };
}

function useWidgetOnlyAsRequest(operation: OperationLike): void {
  operation.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Widget' },
      },
    },
  };
  operation.responses = { '200': { description: 'ok' } };
}

void test('findBreakingChanges reports nothing between two identical documents', () => {
  const { doc } = fixture();
  assert.deepEqual(findBreakingChanges(doc, doc), []);
});

void test('findBreakingChanges reports nothing between the real document and itself', () => {
  const doc = buildOpenApiDocument() as unknown as OpenApiDocumentLike;
  assert.deepEqual(findBreakingChanges(doc, doc), []);
});

void test('detects a removed path', () => {
  const { doc: before } = fixture();
  const { doc: after } = fixture();
  after.paths = {};

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('/api/v1/widgets: path removed')));
});

void test('detects a removed operation on a path that still exists', () => {
  const { doc: before, getOperation } = fixture();
  before.paths['/api/v1/widgets'] = {
    get: getOperation,
    post: { responses: { '200': { description: 'ok' } } },
  };
  const { doc: after } = fixture();

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('POST /api/v1/widgets: operation removed')));
});

void test('detects a removed response status', () => {
  const { doc: before } = fixture();
  const { doc: after, getOperation: afterOp } = fixture();
  afterOp.responses = { '200': { description: 'ok' } };
  void after;

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('response `400` removed')));
});

void test('detects an endpoint that newly requires authentication', () => {
  const { doc: before, getOperation: beforeOp } = fixture();
  beforeOp.security = [];
  const { doc: after } = fixture();

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('now requires authentication')));
});

void test('detects a parameter tightened from optional to required', () => {
  const { doc: before } = fixture();
  const { doc: after, cursorParam } = fixture();
  cursorParam.required = true;

  const findings = findBreakingChanges(before, after);
  assert.ok(
    findings.some((f) => f.message.includes('tightened from optional to required')),
  );
});

void test('detects a removed required parameter', () => {
  const { doc: before, cursorParam } = fixture();
  cursorParam.required = true;
  const { doc: after, getOperation: afterOp } = fixture();
  afterOp.parameters = [];

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('parameter `cursor`')));
});

void test('detects a removed optional parameter because existing clients may still send it', () => {
  const { doc: before } = fixture();
  const { doc: after, getOperation: afterOp } = fixture();
  afterOp.parameters = [];

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('parameter `cursor`')));
});

void test('detects a parameter type change', () => {
  const { doc: before } = fixture();
  const { doc: after, cursorParam } = fixture();
  cursorParam.schema = { type: 'integer' };

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('type changed (string -> integer)')));
});

void test('detects a removed response schema field', () => {
  const { doc: before } = fixture();
  const { doc: after, widgetSchema } = fixture();
  delete widgetSchema.properties!.name;

  const findings = findBreakingChanges(before, after);
  assert.ok(findings.some((f) => f.message.includes('Widget.name: field removed')));
});

void test('does not flag a response field tightened from optional to required', () => {
  const { doc: before } = fixture();
  const { doc: after, widgetSchema } = fixture();
  widgetSchema.required = ['id', 'name'];

  assert.deepEqual(findBreakingChanges(before, after), []);
});

void test('detects a response field loosened from required to optional', () => {
  const { doc: before } = fixture();
  const { doc: after, widgetSchema } = fixture();
  widgetSchema.required = [];

  const findings = findBreakingChanges(before, after);
  assert.ok(
    findings.some((f) =>
      f.message.includes('Widget.id: response field loosened from required to optional'),
    ),
  );
});

void test('does not flag a response field that stops allowing null', () => {
  const { doc: before } = fixture();
  const { doc: after, widgetSchema } = fixture();
  widgetSchema.properties!.note = { type: 'string' };

  assert.deepEqual(findBreakingChanges(before, after), []);
});

void test('detects a response field that newly allows null', () => {
  const { doc: before } = fixture();
  const { doc: after, widgetSchema } = fixture();
  widgetSchema.properties!.name = { type: ['string', 'null'] };

  const findings = findBreakingChanges(before, after);
  assert.ok(
    findings.some((f) => f.message.includes('Widget.name: response output may now be null')),
  );
});

void test('detects request fields tightened to required or non-null, but not loosened request input', () => {
  const { doc: before, getOperation: beforeOperation } = fixture();
  useWidgetOnlyAsRequest(beforeOperation);
  const { doc: after, getOperation: afterOperation, widgetSchema } = fixture();
  useWidgetOnlyAsRequest(afterOperation);
  widgetSchema.required = ['id', 'name'];
  widgetSchema.properties!.note = { type: 'string' };

  const findings = findBreakingChanges(before, after);
  assert.ok(
    findings.some((f) =>
      f.message.includes('Widget.name: request field tightened from optional to required'),
    ),
  );
  assert.ok(
    findings.some((f) => f.message.includes('Widget.note: request input no longer accepts null')),
  );

  const { doc: loosenedAfter, getOperation: loosenedOperation, widgetSchema: loosened } = fixture();
  useWidgetOnlyAsRequest(loosenedOperation);
  loosened.required = [];
  loosened.properties!.name = { type: ['string', 'null'] };
  assert.deepEqual(findBreakingChanges(before, loosenedAfter), []);
});

void test('detects a newly-required request field and a removed referenced component', () => {
  const { doc: before, getOperation: beforeOperation } = fixture();
  useWidgetOnlyAsRequest(beforeOperation);
  const { doc: after, getOperation: afterOperation, widgetSchema } = fixture();
  useWidgetOnlyAsRequest(afterOperation);
  widgetSchema.properties!.extra = { type: 'string' };
  widgetSchema.required = ['id', 'extra'];

  const addedFindings = findBreakingChanges(before, after);
  assert.ok(
    addedFindings.some((finding) =>
      finding.message.includes('Widget.extra: new required request field'),
    ),
  );

  const { doc: removed } = fixture();
  removed.components = { schemas: {} };
  const removedFindings = findBreakingChanges(before, removed);
  assert.ok(
    removedFindings.some((finding) =>
      finding.message.includes('Widget: referenced component schema removed'),
    ),
  );
});

void test('detects a schema field type change', () => {
  const { doc: before } = fixture();
  const { doc: after, widgetSchema } = fixture();
  widgetSchema.properties!.id = { type: 'integer' };

  const findings = findBreakingChanges(before, after);
  assert.ok(
    findings.some((f) => f.message.includes('Widget.id: type changed (string -> integer)')),
  );
});

void test('does not flag purely additive changes: new path, new optional param, new response, new schema field', () => {
  const { doc: before } = fixture();
  const { doc: after, parameters, getOperation, widgetSchema } = fixture();
  after.paths['/api/v1/gadgets'] = {
    get: { responses: { '200': { description: 'ok' } } },
  };
  parameters.push({ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } });
  getOperation.responses = { ...getOperation.responses, '404': { description: 'not found' } };
  widgetSchema.properties!.extra = { type: 'string' };

  assert.deepEqual(findBreakingChanges(before, after), []);
});
