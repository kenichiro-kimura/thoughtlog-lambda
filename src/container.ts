import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { githubRequest } from "./utils/http";
import { GitHubAuthService } from "./services/authService";
import { GitHubApiService } from "./services/githubService";
import { DynamoDBIdempotencyService } from "./services/idempotencyService";
import { SecretsManagerSecretProvider } from "./services/secretProvider";
import { ThoughtLogService } from "./services/thoughtLogService";
import type { ThoughtLogConfig } from "./services/thoughtLogService";

// Clients are created once at module load to reuse connections across invocations.
const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } },
);
const secretsClient = new SecretsManagerClient({});

export interface ContainerEnv extends ThoughtLogConfig {
    githubAppId: string | undefined;
    githubInstallationId: string | undefined;
    githubPrivateKeySecretArn: string | undefined;
    idempotencyTable: string | undefined;
    idempotencyTtlDays: number | undefined;
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
        githubRequest,
    );
    const github = new GitHubApiService(githubRequest);
    const idempotency = new DynamoDBIdempotencyService(ddb, env.idempotencyTable, env.idempotencyTtlDays);

    return new ThoughtLogService(auth, github, idempotency, {
        owner: env.owner,
        repo: env.repo,
        defaultLabels: env.defaultLabels,
    });
}
