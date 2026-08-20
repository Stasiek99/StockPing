import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { SchedulerStack } from '../lib/scheduler-stack';

const app = new cdk.App();
const dataStack = new DataStack(app, 'TestDataStack');
const authStack = new AuthStack(app, 'TestAuthStack');
const schedulerStack = new SchedulerStack(app, 'TestSchedulerStack', {
  table: dataStack.table,
  userPool: authStack.userPool,
  legacyApiUrl: 'https://legacy-test.ngrok-free.dev',
  sesFromEmail: 'notifications@example.com',
});

const template = Template.fromStack(schedulerStack);
const templateJson = JSON.stringify(template.toJSON());

test('SchedulerStack deploys checkStockAndNotify as a Node 20 Lambda with the required config', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs20.x',
    Timeout: 30,
    Environment: {
      Variables: Match.objectLike({
        LEGACY_API_URL: 'https://legacy-test.ngrok-free.dev',
        SES_FROM_EMAIL: 'notifications@example.com',
      }),
    },
  });
});

test('SchedulerStack triggers checkStockAndNotify on a 15-minute EventBridge schedule', () => {
  template.hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'rate(15 minutes)',
    State: 'ENABLED',
  });

  const rules = template.findResources('AWS::Events::Rule');
  expect(Object.keys(rules)).toHaveLength(1);
  const [rule] = Object.values(rules) as any[];
  expect(rule.Properties.Targets).toHaveLength(1);
});

test('checkStockAndNotify execution role is scoped to exactly Query on GSI1 and UpdateItem on the table (least privilege)', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp('^CheckStockAndNotifyFn') }),
  });

  expect(Object.keys(policies)).toHaveLength(1);
  const [policy] = Object.values(policies) as any[];
  const statements = policy.Properties.PolicyDocument.Statement as any[];

  const queryStatement = statements.find((stmt) => stmt.Action === 'dynamodb:Query');
  expect(queryStatement).toBeDefined();
  expect(JSON.stringify(queryStatement.Resource)).toContain('/index/GSI1');

  const updateStatement = statements.find((stmt) => stmt.Action === 'dynamodb:UpdateItem');
  expect(updateStatement).toBeDefined();
  expect(JSON.stringify(updateStatement.Resource)).not.toContain('/index/');
});

test('checkStockAndNotify may only call cognito-idp:AdminGetUser, scoped to the AuthStack User Pool', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp('^CheckStockAndNotifyFn') }),
  });
  const [policy] = Object.values(policies) as any[];
  const cognitoStatement = policy.Properties.PolicyDocument.Statement.find(
    (stmt: any) => stmt.Action === 'cognito-idp:AdminGetUser'
  );

  expect(cognitoStatement).toBeDefined();
  expect(JSON.stringify(cognitoStatement.Resource)).toContain('TestAuthStack');
});

test('checkStockAndNotify may only send email (not raw MIME) as the configured SES identity', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp('^CheckStockAndNotifyFn') }),
  });
  const [policy] = Object.values(policies) as any[];
  const sesStatement = policy.Properties.PolicyDocument.Statement.find((stmt: any) =>
    JSON.stringify(stmt.Action).includes('ses:SendEmail')
  );

  expect(sesStatement.Action).toBe('ses:SendEmail');
  expect(JSON.stringify(sesStatement.Resource)).toContain('identity/notifications@example.com');
});

test('no execution role in SchedulerStack is granted a service-wide wildcard action', () => {
  expect(templateJson).not.toContain('dynamodb:*');
  expect(templateJson).not.toContain('cognito-idp:*');
  expect(templateJson).not.toContain('"ses:*"');
});

test('checkStockAndNotify does not use the AWS-managed AWSLambdaBasicExecutionRole (account-wide logs:* wildcard)', () => {
  expect(templateJson).not.toContain('AWSLambdaBasicExecutionRole');
});

test('checkStockAndNotify CloudWatch Logs permissions are scoped to its own log group, not the whole account', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp('^CheckStockAndNotifyFn') }),
  });
  const [policy] = Object.values(policies) as any[];
  const logsStatement = policy.Properties.PolicyDocument.Statement.find((stmt: any) =>
    JSON.stringify(stmt.Action).includes('logs:')
  );

  expect(logsStatement).toBeDefined();
  expect(logsStatement.Action).toEqual(expect.arrayContaining(['logs:CreateLogStream', 'logs:PutLogEvents']));
  expect(JSON.stringify(logsStatement.Resource)).not.toBe('"arn:aws:logs:*:*:*"');
});
