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

test('checkStockAndNotify execution role is scoped to exactly Query and UpdateItem on the table (least privilege)', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp('^CheckStockAndNotifyFn') }),
  });

  expect(Object.keys(policies)).toHaveLength(1);
  const [policy] = Object.values(policies) as any[];
  const dynamoStatement = policy.Properties.PolicyDocument.Statement.find((stmt: any) =>
    JSON.stringify(stmt.Action).includes('dynamodb:')
  );

  expect(dynamoStatement.Action).toEqual(expect.arrayContaining(['dynamodb:Query', 'dynamodb:UpdateItem']));
  expect(dynamoStatement.Action).toHaveLength(2);
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

test('checkStockAndNotify may only send email as the configured SES identity', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: Match.objectLike({ PolicyName: Match.stringLikeRegexp('^CheckStockAndNotifyFn') }),
  });
  const [policy] = Object.values(policies) as any[];
  const sesStatement = policy.Properties.PolicyDocument.Statement.find((stmt: any) =>
    JSON.stringify(stmt.Action).includes('ses:SendEmail')
  );

  expect(sesStatement.Action).toEqual(expect.arrayContaining(['ses:SendEmail', 'ses:SendRawEmail']));
  expect(JSON.stringify(sesStatement.Resource)).toContain('identity/notifications@example.com');
});

test('no execution role in SchedulerStack is granted a service-wide wildcard action', () => {
  expect(templateJson).not.toContain('dynamodb:*');
  expect(templateJson).not.toContain('cognito-idp:*');
  expect(templateJson).not.toContain('"ses:*"');
});
