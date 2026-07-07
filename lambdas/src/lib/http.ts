import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export function jsonResponse(statusCode: number, body?: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}
