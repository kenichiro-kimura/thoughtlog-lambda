import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { githubRequest, openAIRequest } from "./utils/http";
import type { HttpClient } from "./utils/http";
import { captureAWSv3Client, XRayTracingService } from "./utils/xray";
import type { ITracingService } from "./interfaces/ITracingService";
import { GitHubAuthService } from "./services/authService";
import { GitHubApiService } from "./services/githubService";
import { DynamoDBIdempotencyService } from "./services/idempotencyService";
import { SecretsManagerSecretProvider } from "./services/secretProvider";
import { OpenAITextRefinerService } from "./services/openAIService";
import { SqsQueueService } from "./services/sqsService";
import { ThoughtLogService } from "./services/thoughtLogService";
import { VoiceCommentRefinerService } from "./services/voiceCommentRefiner";
import type { ThoughtLogConfig } from "./services/thoughtLogService";

// Clients are created once at module load to reuse connections across invocations.
const ddb = DynamoDBDocumentClient.from(
    captureAWSv3Client(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } },
);
const secretsClient = captureAWSv3Client(new SecretsManagerClient({}));
const sqsClient = captureAWSv3Client(new SQSClient({}));

// Tracer is created once and shared across all wired services.
const tracer: ITracingService = new XRayTracingService();

/**
 * Wraps an HttpClient so every call is recorded as a named trace subsegment.
 * Tracing is applied transparently; the wrapped client behaves identically otherwise.
 */
function withTracing(name: string, client: HttpClient): HttpClient {
    return (url, options) => tracer.withSubsegment(name, () => client(url, options));
}

const tracedGithubRequest = withTracing("GitHub API", githubRequest);
const tracedOpenAIRequest = withTracing("OpenAI", openAIRequest);

export interface ContainerEnv extends ThoughtLogConfig {
    githubAppId: string | undefined;
    githubInstallationId: string | undefined;
    githubPrivateKeySecretArn: string | undefined;
    idempotencyTable: string | undefined;
    idempotencyTtlDays: number | undefined;
    openAiModel: string | undefined;
    openAiSystemPrompt: string | undefined;
    voiceQueueUrl: string | undefined;
}

/**
 * Wires up all concrete service implementations and returns a ready-to-use ThoughtLogService.
 * This is the single place where the dependency graph is assembled.
 */
export function createThoughtLogService(env: ContainerEnv): ThoughtLogService {
    if (!env.githubPrivateKeySecretArn) {
        throw new Error("Missing env: GITHUB_PRIVATE_KEY_SECRET_ARN");
    }
    const secretProvider = new SecretsManagerSecretProvider(env.githubPrivateKeySecretArn, secretsClient);
    const auth = new GitHubAuthService(
        env.githubAppId,
        env.githubInstallationId,
        secretProvider,
        tracedGithubRequest,
    );
    const github = new GitHubApiService(tracedGithubRequest);
    const idempotency = new DynamoDBIdempotencyService(ddb, env.idempotencyTable, env.idempotencyTtlDays);

    const queueService = env.voiceQueueUrl
        ? new SqsQueueService(sqsClient, env.voiceQueueUrl)
        : undefined;

    return new ThoughtLogService(auth, github, idempotency, {
        owner: env.owner,
        repo: env.repo,
        defaultLabels: env.defaultLabels,
    }, queueService);
}

export interface QueueHandlerEnv {
    githubAppId: string | undefined;
    githubInstallationId: string | undefined;
    githubPrivateKeySecretArn: string | undefined;
    openAiModel: string | undefined;
    openAiSystemPrompt: string | undefined;
}

/**
 * Wires up the VoiceCommentRefinerService for the SQS queue handler.
 */
export function createVoiceCommentRefiner(env: QueueHandlerEnv): VoiceCommentRefinerService {
    if (!env.githubPrivateKeySecretArn) {
        throw new Error("Missing env: GITHUB_PRIVATE_KEY_SECRET_ARN");
    }
    if (!env.githubAppId) {
        throw new Error("Missing env: GITHUB_APP_ID");
    }
    if (!env.githubInstallationId) {
        throw new Error("Missing env: GITHUB_INSTALLATION_ID");
    }
    const secretProvider = new SecretsManagerSecretProvider(env.githubPrivateKeySecretArn, secretsClient);
    const auth = new GitHubAuthService(
        env.githubAppId,
        env.githubInstallationId,
        secretProvider,
        tracedGithubRequest,
    );
    const github = new GitHubApiService(tracedGithubRequest);
    const textRefiner = new OpenAITextRefinerService(
        secretProvider,
        tracedOpenAIRequest,
        env.openAiModel,
        env.openAiSystemPrompt,
    );
    return new VoiceCommentRefinerService(auth, github, textRefiner);
}
