import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { githubRequest } from "./utils/http";
import { GitHubAuthService } from "./services/authService";
import { GitHubApiService } from "./services/githubService";
import { DynamoDBIdempotencyService } from "./services/idempotencyService";
import { ThoughtLogService } from "./services/thoughtLogService";
import type { ThoughtLogConfig } from "./services/thoughtLogService";

// DynamoDB client is created once at module load to reuse connections across invocations.
const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } },
);

export interface ContainerEnv extends ThoughtLogConfig {
    githubAppId: string | undefined;
    githubInstallationId: string | undefined;
    githubPrivateKeyPem: string | undefined;
    idempotencyTable: string | undefined;
    idempotencyTtlDays: number | undefined;
}

/**
 * Wires up all concrete service implementations and returns a ready-to-use ThoughtLogService.
 * This is the single place where the dependency graph is assembled.
 */
export function createThoughtLogService(env: ContainerEnv): ThoughtLogService {
    const auth = new GitHubAuthService(
        env.githubAppId,
        env.githubInstallationId,
        env.githubPrivateKeyPem,
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
