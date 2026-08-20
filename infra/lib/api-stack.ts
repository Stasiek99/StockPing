import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { scopedLambdaLogging } from './scoped-lambda-logging';

const LAMBDAS_DIR = path.join(__dirname, '..', '..', 'lambdas', 'src');

export interface ApiStackProps extends cdk.StackProps {
  table: dynamodb.Table;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { table, userPool, userPoolClient } = props;

    const authorizer = new HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] }
    );

    this.httpApi = new apigwv2.HttpApi(this, 'StockPingHttpApi', {
      apiName: 'StockPingHttpApi',
      // Every route needs the Cognito JWT — this project has no public routes.
      defaultAuthorizer: authorizer,
    });

    const commonEnvironment = { TABLE_NAME: table.tableName };

    const createWatchLogging = scopedLambdaLogging(this, 'CreateWatchFn');
    const createWatchFn = new NodejsFunction(this, 'CreateWatchFn', {
      entry: path.join(LAMBDAS_DIR, 'createWatch.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnvironment,
      role: createWatchLogging.role,
      logGroup: createWatchLogging.logGroup,
    });
    // Scoped to the table only (no `/index/*`) — this Lambda never touches GSI1.
    createWatchFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:PutItem'], resources: [table.tableArn] })
    );

    const listWatchesLogging = scopedLambdaLogging(this, 'ListWatchesFn');
    const listWatchesFn = new NodejsFunction(this, 'ListWatchesFn', {
      entry: path.join(LAMBDAS_DIR, 'listWatches.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnvironment,
      role: listWatchesLogging.role,
      logGroup: listWatchesLogging.logGroup,
    });
    listWatchesFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [table.tableArn] })
    );

    const deleteWatchLogging = scopedLambdaLogging(this, 'DeleteWatchFn');
    const deleteWatchFn = new NodejsFunction(this, 'DeleteWatchFn', {
      entry: path.join(LAMBDAS_DIR, 'deleteWatch.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnvironment,
      role: deleteWatchLogging.role,
      logGroup: deleteWatchLogging.logGroup,
    });
    deleteWatchFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:DeleteItem'], resources: [table.tableArn] })
    );

    this.httpApi.addRoutes({
      path: '/watches',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateWatchIntegration', createWatchFn),
    });

    this.httpApi.addRoutes({
      path: '/watches',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListWatchesIntegration', listWatchesFn),
    });

    this.httpApi.addRoutes({
      path: '/watches/{productId}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('DeleteWatchIntegration', deleteWatchFn),
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
