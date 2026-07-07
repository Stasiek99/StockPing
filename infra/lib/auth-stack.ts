import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'StockPingUserPool', {
      userPoolName: 'StockPingUserPool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Practice project — allow `cdk destroy` to clean up on Day 5 with no orphaned pool.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'StockPingUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'StockPingWebClient',
      generateSecret: false,
      authFlows: {
        userPassword: true,
      },
      // Only the CLI-driven USER_PASSWORD_AUTH flow is needed this week — no Hosted UI/OAuth.
      disableOAuth: true,
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
