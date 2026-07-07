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

    const createWatchFn = new NodejsFunction(this, 'CreateWatchFn', {
      entry: path.join(LAMBDAS_DIR, 'createWatch.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnvironment,
    });
    table.grant(createWatchFn, 'dynamodb:PutItem');

    const listWatchesFn = new NodejsFunction(this, 'ListWatchesFn', {
      entry: path.join(LAMBDAS_DIR, 'listWatches.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnvironment,
    });
    table.grant(listWatchesFn, 'dynamodb:Query');

    const deleteWatchFn = new NodejsFunction(this, 'DeleteWatchFn', {
      entry: path.join(LAMBDAS_DIR, 'deleteWatch.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: commonEnvironment,
    });
    table.grant(deleteWatchFn, 'dynamodb:DeleteItem');

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
