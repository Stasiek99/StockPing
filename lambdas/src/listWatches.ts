import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './lib/ddb-client';
import { getUserId } from './lib/auth';
import { jsonResponse } from './lib/http';
import { createLogger } from './lib/logger';
import type { Watch } from './lib/watch';

const logger = createLogger('listWatches');

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = getUserId(event);

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':skPrefix': 'WATCH#',
        },
      })
    );

    const watches: Watch[] = (result.Items ?? []).map((item) => ({
      productId: item.productId,
      createdAt: item.createdAt,
      notified: item.notified,
    }));

    logger.info('watches listed', { userId, count: watches.length });
    return jsonResponse(200, { watches });
  } catch (err) {
    logger.error('failed to list watches', err, { userId });
    return jsonResponse(500, { message: 'Internal server error' });
  }
};
