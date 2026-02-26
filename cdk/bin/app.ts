#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ThoughtlogStack } from '../lib/thoughtlog-stack';

const app = new cdk.App();
new ThoughtlogStack(app, 'ThoughtlogStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
