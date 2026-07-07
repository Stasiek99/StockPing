import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/** Reads the Cognito user id (`sub` claim) that the HTTP API JWT authorizer already verified. */
export function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer.jwt.claims.sub;

  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('Missing sub claim on JWT authorizer context');
  }

  return sub;
}
