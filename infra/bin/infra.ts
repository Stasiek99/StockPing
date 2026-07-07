#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new DataStack(app, 'DataStack', { env });
new AuthStack(app, 'AuthStack', { env });
