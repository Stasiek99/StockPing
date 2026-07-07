import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './lib/ddb-client';
import { getUserId } from './lib/auth';
import { jsonResponse } from './lib/http';
import { watchKey } from './lib/watch';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = getUserId(event);

  let productId: unknown;
  try {
    productId = event.body ? JSON.parse(event.body).productId : undefined;
  } catch {
    return jsonResponse(400, { message: 'Request body must be valid JSON' });
  }

  if (typeof productId !== 'string' || productId.trim().length === 0) {
    return jsonResponse(400, { message: 'productId is required' });
  }

  const createdAt = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...watchKey(userId, productId),
          GSI1PK: `PRODUCT#${productId}`,
          GSI1SK: `USER#${userId}`,
          productId,
          createdAt,
          notified: false,
        },
        // Idempotent create: reject a duplicate watch instead of silently resetting `notified`.
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return jsonResponse(409, { message: 'Already watching this product' });
    }
    console.error('createWatch failed', err);
    return jsonResponse(500, { message: 'Internal server error' });
  }

  return jsonResponse(201, { productId, createdAt, notified: false });
};
