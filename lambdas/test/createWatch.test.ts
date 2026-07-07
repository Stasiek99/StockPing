import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../src/createWatch';
import { buildEvent } from './build-event';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

test('creates a watch and returns 201 with the created record', async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(buildEvent({ userId: 'user-1', body: JSON.stringify({ productId: 'prod-1' }) }));

  expect(result.statusCode).toBe(201);
  expect(JSON.parse(result.body as string)).toMatchObject({ productId: 'prod-1', notified: false });
});

test('writes the item keyed by the authorizer sub claim, not a client-supplied id', async () => {
  ddbMock.on(PutCommand).resolves({});

  await handler(buildEvent({ userId: 'user-1', body: JSON.stringify({ productId: 'prod-1', userId: 'someone-else' }) }));

  const putCalls = ddbMock.commandCalls(PutCommand);
  expect(putCalls).toHaveLength(1);
  expect(putCalls[0].args[0].input.Item).toMatchObject({
    PK: 'USER#user-1',
    SK: 'WATCH#prod-1',
    GSI1PK: 'PRODUCT#prod-1',
    GSI1SK: 'USER#user-1',
  });
  expect(putCalls[0].args[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
});

test('rejects a missing productId with 400 and never calls DynamoDB', async () => {
  const result = await handler(buildEvent({ body: JSON.stringify({}) }));

  expect(result.statusCode).toBe(400);
  expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
});

test('rejects a non-JSON body with 400', async () => {
  const result = await handler(buildEvent({ body: '{not-json' }));

  expect(result.statusCode).toBe(400);
  expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
});

test('returns 409 when the watch already exists', async () => {
  const conditionalCheckFailed = Object.assign(new Error('conditional check failed'), {
    name: 'ConditionalCheckFailedException',
  });
  ddbMock.on(PutCommand).rejects(conditionalCheckFailed);

  const result = await handler(buildEvent({ body: JSON.stringify({ productId: 'prod-1' }) }));

  expect(result.statusCode).toBe(409);
});

test('returns 500 on an unexpected DynamoDB failure', async () => {
  ddbMock.on(PutCommand).rejects(new Error('service unavailable'));

  const result = await handler(buildEvent({ body: JSON.stringify({ productId: 'prod-1' }) }));

  expect(result.statusCode).toBe(500);
});
