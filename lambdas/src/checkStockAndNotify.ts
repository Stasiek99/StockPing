import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { ddb, TABLE_NAME } from './lib/ddb-client';
import { requireEnv } from './lib/env';
import { createLogger } from './lib/logger';

const LEGACY_API_URL = requireEnv('LEGACY_API_URL');
const USER_POOL_ID = requireEnv('USER_POOL_ID');
const SES_FROM_EMAIL = requireEnv('SES_FROM_EMAIL');

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESClient({});
const logger = createLogger('checkStockAndNotify');

interface Product {
  id: string;
  name: string;
  stock: number;
}

export const handler = async (): Promise<void> => {
  const restocked = await fetchRestockedProducts();
  logger.info('checked legacy stock', { restockedCount: restocked.length });

  for (const product of restocked) {
    await notifyWatchers(product);
  }
};

async function fetchRestockedProducts(): Promise<Product[]> {
  const res = await fetch(`${LEGACY_API_URL}/products`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });

  if (!res.ok) {
    throw new Error(`legacy /products request failed with status ${res.status}`);
  }

  const products = (await res.json()) as Product[];
  return products.filter((product) => product.stock > 0);
}

async function notifyWatchers(product: Product): Promise<void> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `PRODUCT#${product.id}` },
    })
  );

  const pendingWatchers = (result.Items ?? []).filter((item) => item.notified === false);

  for (const watcher of pendingWatchers) {
    await notifyWatcher(product, watcher.PK as string, watcher.SK as string);
  }
}

async function notifyWatcher(product: Product, pk: string, sk: string): Promise<void> {
  const userId = pk.replace('USER#', '');

  const email = await getUserEmail(userId).catch((err: unknown) => {
    logger.error('failed to resolve watcher email', err, { userId });
    return undefined;
  });

  if (!email) {
    return;
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Source: SES_FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `${product.name} is back in stock!` },
          Body: {
            Text: {
              Data: `${product.name} is back in stock (${product.stock} available). Get it before it sells out again.`,
            },
          },
        },
      })
    );
  } catch (err) {
    logger.error('failed to send restock email', err, { userId, productId: product.id });
    return;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'SET notified = :true',
      ExpressionAttributeValues: { ':true': true },
    })
  );

  logger.info('watcher notified', { userId, productId: product.id });
}

async function getUserEmail(userId: string): Promise<string | undefined> {
  const result = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }));
  return result.UserAttributes?.find((attr) => attr.Name === 'email')?.Value;
}
