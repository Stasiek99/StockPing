import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

if (!process.env.TABLE_NAME) {
  throw new Error('TABLE_NAME environment variable is required');
}

export const TABLE_NAME = process.env.TABLE_NAME;

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
