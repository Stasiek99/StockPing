#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { SchedulerStack } from '../lib/scheduler-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

const dataStack = new DataStack(app, 'DataStack', { env });
const authStack = new AuthStack(app, 'AuthStack', { env });

new ApiStack(app, 'ApiStack', {
  env,
  table: dataStack.table,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

// Only needed to synth/deploy this stack — the ngrok tunnel URL changes every
// restart and the SES sender must already be a verified identity, so both are
// supplied at deploy time rather than hardcoded.
const legacyApiUrl = process.env.LEGACY_API_URL;
const sesFromEmail = process.env.SES_FROM_EMAIL;

if (legacyApiUrl && sesFromEmail) {
  new SchedulerStack(app, 'SchedulerStack', {
    env,
    table: dataStack.table,
    userPool: authStack.userPool,
    legacyApiUrl,
    sesFromEmail,
  });
} else {
  console.warn('Skipping SchedulerStack: set LEGACY_API_URL and SES_FROM_EMAIL to synthesize/deploy it.');
}
