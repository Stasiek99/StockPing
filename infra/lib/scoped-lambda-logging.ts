import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * CDK's default Lambda execution role attaches the AWS-managed
 * `AWSLambdaBasicExecutionRole` policy, which grants `logs:CreateLogGroup`,
 * `logs:CreateLogStream`, and `logs:PutLogEvents` on every log group in the
 * account/region (`Resource: arn:aws:logs:*:*:*`). Building the role and log
 * group here instead scopes those actions to the one log group each function
 * actually writes to.
 */
export function scopedLambdaLogging(scope: Construct, id: string): { role: iam.Role; logGroup: logs.LogGroup } {
  const role = new iam.Role(scope, `${id}Role`, {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });

  const logGroup = new logs.LogGroup(scope, `${id}LogGroup`, {
    retention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  logGroup.grantWrite(role);

  return { role, logGroup };
}
