import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './lib/ddb-client';
import { getUserId } from './lib/auth';
import { jsonResponse } from './lib/http';
import { deleteWatchParamsSchema } from './lib/schemas';
import { parseParams } from './lib/validation';
import { watchKey } from './lib/watch';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = getUserId(event);

  const parsed = parseParams(deleteWatchParamsSchema, event.pathParameters);
  if (!parsed.success) {
    return parsed.response;
  }
  const { productId } = parsed.data;

  try {
    const result = await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: watchKey(userId, productId),
        ReturnValues: 'ALL_OLD',
      })
    );

    if (!result.Attributes) {
      return jsonResponse(404, { message: 'Watch not found' });
    }

    return jsonResponse(204);
  } catch (err) {
    console.error('deleteWatch failed', err);
    return jsonResponse(500, { message: 'Internal server error' });
  }
};
