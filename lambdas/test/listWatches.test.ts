import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../src/listWatches';
import { buildEvent } from './build-event';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

test('returns the watches belonging to the authenticated user', async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      { productId: 'prod-1', createdAt: '2026-01-01T00:00:00.000Z', notified: false },
      { productId: 'prod-2', createdAt: '2026-01-02T00:00:00.000Z', notified: true },
    ],
  });

  const result = await handler(buildEvent({ userId: 'user-1' }));

  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body as string)).toEqual({
    watches: [
      { productId: 'prod-1', createdAt: '2026-01-01T00:00:00.000Z', notified: false },
      { productId: 'prod-2', createdAt: '2026-01-02T00:00:00.000Z', notified: true },
    ],
  });
});

test('queries only the requesting user\'s partition, scoped by the authorizer sub claim', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  await handler(buildEvent({ userId: 'user-42' }));

  const queryCalls = ddbMock.commandCalls(QueryCommand);
  expect(queryCalls).toHaveLength(1);
  expect(queryCalls[0].args[0].input.ExpressionAttributeValues).toEqual({
    ':pk': 'USER#user-42',
    ':skPrefix': 'WATCH#',
  });
});

test('returns an empty list when the user has no watches', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  const result = await handler(buildEvent({ userId: 'user-1' }));

  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body as string)).toEqual({ watches: [] });
});

test('returns 500 on an unexpected DynamoDB failure', async () => {
  ddbMock.on(QueryCommand).rejects(new Error('service unavailable'));

  const result = await handler(buildEvent({ userId: 'user-1' }));

  expect(result.statusCode).toBe(500);
});
