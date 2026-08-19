import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';

const LAMBDAS_DIR = path.join(__dirname, '..', '..', 'lambdas', 'src');

export interface SchedulerStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  userPool: cognito.UserPool;
  /** Public URL of the legacy-express service (its ngrok tunnel for this week). */
  legacyApiUrl: string;
  /** SES sender identity — must already be verified (sandbox mode). */
  sesFromEmail: string;
}

export class SchedulerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);

    const { table, userPool, legacyApiUrl, sesFromEmail } = props;

    const checkStockAndNotifyFn = new NodejsFunction(this, 'CheckStockAndNotifyFn', {
      entry: path.join(LAMBDAS_DIR, 'checkStockAndNotify.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      // Sequential SES sends (sandbox rate limit) across every watcher of every
      // restocked product can outrun the default 3s timeout.
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        LEGACY_API_URL: legacyApiUrl,
        USER_POOL_ID: userPool.userPoolId,
        SES_FROM_EMAIL: sesFromEmail,
      },
    });

    table.grant(checkStockAndNotifyFn, 'dynamodb:Query', 'dynamodb:UpdateItem');

    checkStockAndNotifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser'],
        resources: [userPool.userPoolArn],
      })
    );

    checkStockAndNotifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${sesFromEmail}`],
      })
    );

    const rule = new events.Rule(this, 'CheckStockScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });
    rule.addTarget(new targets.LambdaFunction(checkStockAndNotifyFn));
  }
}
