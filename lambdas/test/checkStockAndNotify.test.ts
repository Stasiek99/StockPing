import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { handler } from '../src/checkStockAndNotify';

const ddbMock = mockClient(DynamoDBDocumentClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);
const sesMock = mockClient(SESClient);

function mockProducts(products: Array<{ id: string; name: string; stock: number }>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => products,
  }) as jest.Mock;
}

beforeEach(() => {
  ddbMock.reset();
  cognitoMock.reset();
  sesMock.reset();
  cognitoMock.on(AdminGetUserCommand).resolves({ UserAttributes: [{ Name: 'email', Value: 'watcher@example.com' }] });
  sesMock.on(SendEmailCommand).resolves({});
});

test('does nothing when no products are back in stock', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 0 }]);

  await handler();

  expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
});

test('does nothing when a restocked product has no watchers', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 5 }]);
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  await handler();

  expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
});

test('skips watchers already notified', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 5 }]);
  ddbMock.on(QueryCommand).resolves({
    Items: [{ PK: 'USER#user-1', SK: 'WATCH#prod-1', notified: true }],
  });

  await handler();

  expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
});

test('emails a pending watcher and marks the watch as notified', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 5 }]);
  ddbMock.on(QueryCommand).resolves({
    Items: [{ PK: 'USER#user-1', SK: 'WATCH#prod-1', notified: false }],
  });

  await handler();

  const queryCalls = ddbMock.commandCalls(QueryCommand);
  expect(queryCalls).toHaveLength(1);
  expect(queryCalls[0].args[0].input).toMatchObject({
    IndexName: 'GSI1',
    ExpressionAttributeValues: { ':pk': 'PRODUCT#prod-1' },
  });

  const cognitoCalls = cognitoMock.commandCalls(AdminGetUserCommand);
  expect(cognitoCalls).toHaveLength(1);
  expect(cognitoCalls[0].args[0].input).toMatchObject({ Username: 'user-1' });

  const sesCalls = sesMock.commandCalls(SendEmailCommand);
  expect(sesCalls).toHaveLength(1);
  expect(sesCalls[0].args[0].input).toMatchObject({
    Destination: { ToAddresses: ['watcher@example.com'] },
  });

  const updateCalls = ddbMock.commandCalls(UpdateCommand);
  expect(updateCalls).toHaveLength(1);
  expect(updateCalls[0].args[0].input).toMatchObject({
    Key: { PK: 'USER#user-1', SK: 'WATCH#prod-1' },
    UpdateExpression: 'SET notified = :true',
    ExpressionAttributeValues: { ':true': true },
  });
});

test('notifies every pending watcher of a restocked product', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 5 }]);
  ddbMock.on(QueryCommand).resolves({
    Items: [
      { PK: 'USER#user-1', SK: 'WATCH#prod-1', notified: false },
      { PK: 'USER#user-2', SK: 'WATCH#prod-1', notified: false },
    ],
  });

  await handler();

  expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
});

test('does not mark the watch notified when the email fails to send', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 5 }]);
  ddbMock.on(QueryCommand).resolves({
    Items: [{ PK: 'USER#user-1', SK: 'WATCH#prod-1', notified: false }],
  });
  sesMock.on(SendEmailCommand).rejects(new Error('SES sandbox: recipient not verified'));

  await handler();

  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
});

test('skips a watcher whose Cognito user has no email attribute', async () => {
  mockProducts([{ id: 'prod-1', name: 'Keyboard', stock: 5 }]);
  ddbMock.on(QueryCommand).resolves({
    Items: [{ PK: 'USER#user-1', SK: 'WATCH#prod-1', notified: false }],
  });
  cognitoMock.on(AdminGetUserCommand).resolves({ UserAttributes: [] });

  await handler();

  expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
});

test('throws when the legacy products endpoint fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => [] }) as jest.Mock;

  await expect(handler()).rejects.toThrow('legacy /products request failed with status 503');
});
