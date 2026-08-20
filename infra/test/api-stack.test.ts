import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';

// Built once: each NodejsFunction bundles its handler with esbuild at synth
// time, so re-instantiating the stack per test would re-run that bundling
// on every assertion for no benefit — the template is read-only from here on.
const app = new cdk.App();
const dataStack = new DataStack(app, 'TestDataStack');
const authStack = new AuthStack(app, 'TestAuthStack');
const apiStack = new ApiStack(app, 'TestApiStack', {
  table: dataStack.table,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

const template = Template.fromStack(apiStack);
const templateJson = JSON.stringify(template.toJSON());

test('ApiStack creates an HTTP API', () => {
  template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
    Name: 'StockPingHttpApi',
    ProtocolType: 'HTTP',
  });
});

test('ApiStack creates a JWT authorizer wired to the AuthStack User Pool and App Client', () => {
  template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
    AuthorizerType: 'JWT',
    IdentitySource: ['$request.header.Authorization'],
  });

  const authorizers = template.findResources('AWS::ApiGatewayV2::Authorizer');
  const [authorizer] = Object.values(authorizers);
  const jwtConfig = (authorizer as any).Properties.JwtConfiguration;

  // Regression guard: the issuer/audience must reference the Day 2 AuthStack's
  // User Pool / App Client via cross-stack import, not a hardcoded string.
  expect(JSON.stringify(jwtConfig.Issuer)).toContain('AuthStack');
  expect(JSON.stringify(jwtConfig.Issuer)).toContain('UserPool');
  expect(JSON.stringify(jwtConfig.Audience)).toContain('AuthStack');
  expect(JSON.stringify(jwtConfig.Audience)).toContain('UserPoolClient');
  expect(templateJson).toContain('https://cognito-idp.');
});

test('ApiStack puts all three /watches routes behind the JWT authorizer', () => {
  template.resourceCountIs('AWS::ApiGatewayV2::Route', 3);

  for (const routeKey of ['POST /watches', 'GET /watches', 'DELETE /watches/{productId}']) {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: routeKey,
      AuthorizationType: 'JWT',
    });
  }
});

test('ApiStack routes all reference the same authorizer instance', () => {
  const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')) as any[];
  const authorizerRefs = new Set(routes.map((route) => route.Properties.AuthorizerId.Ref));

  expect(routes).toHaveLength(3);
  expect(authorizerRefs.size).toBe(1);
});

test('ApiStack deploys createWatch, listWatches, and deleteWatch as Node 20 Lambdas wired to the table', () => {
  const nodeFunctions = template.findResources('AWS::Lambda::Function', {
    Properties: Match.objectLike({ Runtime: 'nodejs20.x' }),
  });

  expect(Object.keys(nodeFunctions)).toHaveLength(3);

  for (const fn of Object.values(nodeFunctions) as any[]) {
    expect(fn.Properties.Environment.Variables.TABLE_NAME).toBeDefined();
  }
});

test.each([
  ['CreateWatchFn', 'dynamodb:PutItem'],
  ['ListWatchesFn', 'dynamodb:Query'],
  ['DeleteWatchFn', 'dynamodb:DeleteItem'],
])('%s execution role is scoped to exactly %s on the table (least privilege)', (functionIdPrefix, expectedAction) => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp(`^${functionIdPrefix}`) }),
  });

  expect(Object.keys(policies)).toHaveLength(1);
  const [policy] = Object.values(policies) as any[];
  const statements = policy.Properties.PolicyDocument.Statement as any[];

  // One statement for scoped CloudWatch Logs, one for the single DynamoDB action.
  expect(statements).toHaveLength(2);
  const dynamoStatement = statements.find((stmt) => JSON.stringify(stmt.Action).includes('dynamodb:'));
  expect(dynamoStatement).toMatchObject({ Action: expectedAction, Effect: 'Allow' });
  expect(JSON.stringify(dynamoStatement.Resource)).not.toContain('/index/');
});

test('no Lambda execution role is granted the dynamodb:* wildcard action', () => {
  expect(templateJson).not.toContain('dynamodb:*');
});

test('no Lambda in ApiStack uses the AWS-managed AWSLambdaBasicExecutionRole (account-wide logs:* wildcard)', () => {
  expect(templateJson).not.toContain('AWSLambdaBasicExecutionRole');
});

test.each(['CreateWatchFn', 'ListWatchesFn', 'DeleteWatchFn'])(
  "%s's CloudWatch Logs permissions are scoped to its own log group, not the whole account",
  (functionIdPrefix) => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp(`^${functionIdPrefix}`) }),
    });
    const [policy] = Object.values(policies) as any[];
    const logsStatement = policy.Properties.PolicyDocument.Statement.find((stmt: any) =>
      JSON.stringify(stmt.Action).includes('logs:')
    );

    expect(logsStatement).toBeDefined();
    expect(logsStatement.Action).toEqual(expect.arrayContaining(['logs:CreateLogStream', 'logs:PutLogEvents']));
    expect(JSON.stringify(logsStatement.Resource)).not.toBe('"arn:aws:logs:*:*:*"');
  }
);
