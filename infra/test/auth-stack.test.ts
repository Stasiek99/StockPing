import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';

test('AuthStack creates a self-sign-up User Pool with email verification', () => {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Cognito::UserPool', {
    UserPoolName: 'StockPingUserPool',
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    AutoVerifiedAttributes: ['email'],
  });
});

test('AuthStack creates an App Client with no secret using USER_PASSWORD_AUTH', () => {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    ClientName: 'StockPingWebClient',
    GenerateSecret: false,
    ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
  });
});

test('AuthStack does not enable Hosted UI / OAuth on the App Client', () => {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);

  // Regression guard: CDK's UserPoolClient defaults to Hosted UI OAuth
  // (implicit/code flows + a placeholder https://example.com callback URL)
  // unless disableOAuth is set — this stack only wants CLI USER_PASSWORD_AUTH.
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    AllowedOAuthFlowsUserPoolClient: false,
    CallbackURLs: Match.absent(),
    AllowedOAuthFlows: Match.absent(),
  });
});

test('AuthStack User Pool is destroyable (no orphaned resource on cdk destroy)', () => {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);

  template.hasResource('AWS::Cognito::UserPool', {
    DeletionPolicy: 'Delete',
    UpdateReplacePolicy: 'Delete',
  });
});
