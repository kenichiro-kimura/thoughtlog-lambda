import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Auth from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2Int from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { Construct } from 'constructs';

export class ThoughtlogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table for idempotency
    const table = new dynamodb.Table(this, 'IdempotencyTable', {

      partitionKey: {
        name: 'request_id',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Lambda function (Node.js 24, 1 minute timeout)
    const repoRoot = path.join(__dirname, '../..');
    const fn = new lambda.Function(this, 'ThoughtlogFunction', {
      // NOTE: The function name is intentionally hardcoded to match the CD workflow's
      // LAMBDA_FUNCTION_NAME secret. This stack is intended for a single deployment
      // per account/region. If you need multiple environments (dev/staging/prod) in
      // the same account/region, update this to use a dynamic name (e.g., include
      // the stack name or environment) and adjust the CD workflow accordingly.
      functionName: 'thoughtlog',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(repoRoot, {
        bundling: {
          image: lambda.Runtime.NODEJS_24_X.bundlingImage,
          command: [
            'bash', '-c',
            [
              'npm ci',
              'npm run build',
              'cp -r dist /asset-output/',
              'cp package.json package-lock.json /asset-output/',
              'cd /asset-output',
              'npm ci --omit=dev',
            ].join(' && '),
          ],
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                execSync('npm ci && npm run build', {
                  cwd: repoRoot,
                  stdio: 'inherit',
                });
                fs.cpSync(path.join(repoRoot, 'dist'), path.join(outputDir, 'dist'), { recursive: true });
                fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(outputDir, 'package.json'));
                fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(outputDir, 'package-lock.json'));
                execSync('npm ci --omit=dev', {
                  cwd: outputDir,
                  stdio: 'inherit',
                });
                return true;
              } catch (e) {
                console.error('Local bundling failed:', e);
                return false;
              }
            },
          },
        },
      }),
      timeout: cdk.Duration.minutes(1),
      environment: {
        IDEMPOTENCY_TABLE: table.tableName,
      },
    });

    // Grant Lambda read/write access to DynamoDB
    table.grantReadWriteData(fn);

    // EntraID JWT authorizer configuration from CDK context
    const entraIssuer = this.node.tryGetContext('entraIssuer') as string | undefined;
    const entraAudience = this.node.tryGetContext('entraAudience') as string | undefined;

    // Treat missing or placeholder values as "no real Entra configuration"
    const hasRealEntraConfig =
      !!entraIssuer &&
      !!entraAudience &&
      !entraIssuer.includes('TENANT_ID') &&
      entraAudience !== 'CLIENT_ID';

    if (!hasRealEntraConfig) {
      // Allow synthesis without real Entra values; API will be created without a default JWT authorizer.
      // For production, provide real values via context, for example:
      //   cdk deploy -c entraIssuer="https://login.microsoftonline.com/<tenant-id>/v2.0" -c entraAudience="<client-id>"
      console.warn(
        'EntraID context variables "entraIssuer" and "entraAudience" are not set to real values. ' +
        'The HTTP API will be synthesized without a default JWT authorizer.'
      );
    }

    const authorizer = hasRealEntraConfig
      ? new apigwv2Auth.HttpJwtAuthorizer('EntraAuthorizer', entraIssuer as string, {
          jwtAudience: [entraAudience as string],
        })
      : undefined;

    const integration = new apigwv2Int.HttpLambdaIntegration('ThoughtlogIntegration', fn);

    // HTTP API Gateway with optional default JWT authorizer
    const api = new apigwv2.HttpApi(this, 'ThoughtlogApi', {

      description: 'Thoughtlog HTTP API',
      defaultAuthorizer: authorizer,
      defaultIntegration: integration,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.apiEndpoint,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: fn.functionName,
      description: 'Lambda function name',
    });

    new cdk.CfnOutput(this, 'DynamoDbTableName', {
      value: table.tableName,
      description: 'DynamoDB idempotency table name',
    });
  }
}
