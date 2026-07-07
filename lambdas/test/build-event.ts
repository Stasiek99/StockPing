import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

interface BuildEventOptions {
  userId?: string;
  body?: string;
  pathParameters?: Record<string, string>;
}

export function buildEvent({
  userId = 'user-123',
  body,
  pathParameters,
}: BuildEventOptions = {}): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/watches',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test-api.execute-api.eu-west-1.amazonaws.com',
      domainPrefix: 'test-api',
      http: {
        method: 'POST',
        path: '/watches',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest',
      },
      requestId: 'test-request-id',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
      authorizer: {
        principalId: userId,
        integrationLatency: 1,
        jwt: {
          claims: { sub: userId },
          scopes: [],
        },
      },
    },
    body,
    pathParameters,
    isBase64Encoded: false,
  };
}
