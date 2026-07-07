import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './lib/ddb-client';
import { getUserId } from './lib/auth';
import { jsonResponse } from './lib/http';
import { watchKey } from './lib/watch';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = getUserId(event);
  const productId = event.pathParameters?.productId;

  if (!productId) {
    return jsonResponse(400, { message: 'productId path parameter is required' });
  }

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
