import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../src/deleteWatch';
import { buildEvent } from './build-event';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

test('deletes an existing watch and returns 204', async () => {
  ddbMock.on(DeleteCommand).resolves({ Attributes: { PK: 'USER#user-1', SK: 'WATCH#prod-1' } });

  const result = await handler(buildEvent({ userId: 'user-1', pathParameters: { productId: 'prod-1' } }));

  expect(result.statusCode).toBe(204);
});

test('deletes the item keyed by the authorizer sub claim, not a client-supplied id', async () => {
  ddbMock.on(DeleteCommand).resolves({ Attributes: { PK: 'USER#user-1', SK: 'WATCH#prod-1' } });

  await handler(buildEvent({ userId: 'user-1', pathParameters: { productId: 'prod-1' } }));

  const deleteCalls = ddbMock.commandCalls(DeleteCommand);
  expect(deleteCalls).toHaveLength(1);
  expect(deleteCalls[0].args[0].input.Key).toEqual({ PK: 'USER#user-1', SK: 'WATCH#prod-1' });
});

test('returns 404 when the watch does not exist for this user', async () => {
  ddbMock.on(DeleteCommand).resolves({});

  const result = await handler(buildEvent({ userId: 'user-1', pathParameters: { productId: 'prod-1' } }));

  expect(result.statusCode).toBe(404);
});

test('returns 400 when productId path parameter is missing', async () => {
  const result = await handler(buildEvent({ userId: 'user-1', pathParameters: {} }));

  expect(result.statusCode).toBe(400);
  expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
});

test('returns 500 on an unexpected DynamoDB failure', async () => {
  ddbMock.on(DeleteCommand).rejects(new Error('service unavailable'));

  const result = await handler(buildEvent({ userId: 'user-1', pathParameters: { productId: 'prod-1' } }));

  expect(result.statusCode).toBe(500);
});
