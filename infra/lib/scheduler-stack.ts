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
import { scopedLambdaLogging } from './scoped-lambda-logging';

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

    const checkStockAndNotifyLogging = scopedLambdaLogging(this, 'CheckStockAndNotifyFn');
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
      role: checkStockAndNotifyLogging.role,
      logGroup: checkStockAndNotifyLogging.logGroup,
    });

    // Query only ever targets GSI1 (by product); UpdateItem only ever targets
    // the base table (by watch key) — scope each to exactly what it needs
    // instead of granting both actions on the table + every index.
    checkStockAndNotifyFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${table.tableArn}/index/GSI1`] })
    );
    checkStockAndNotifyFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:UpdateItem'], resources: [table.tableArn] })
    );

    checkStockAndNotifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser'],
        resources: [userPool.userPoolArn],
      })
    );

    // Only SendEmail is ever called (no raw MIME sends), so SendRawEmail is left out.
    checkStockAndNotifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${sesFromEmail}`],
      })
    );

    const rule = new events.Rule(this, 'CheckStockScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });
    rule.addTarget(new targets.LambdaFunction(checkStockAndNotifyFn));
  }
}
