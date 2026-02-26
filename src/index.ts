import type { APIGatewayProxyEventV2, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createThoughtLogService } from "./container";
import { LambdaHttpRequest, toLambdaResult } from "./adapters/lambdaAdapter";
import { ThoughtLogRouter } from "./services/thoughtLogRouter";
import { HTTP_STATUS } from "./utils/httpStatus";

export const handler = async (event: APIGatewayProxyEventV2 | APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!owner || !repo) {
        return toLambdaResult({ statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR, body: JSON.stringify({ ok: false, error: "missing_repo_env" }) });
    }

    const ttlEnv = process.env.IDEMPOTENCY_TTL_DAYS;
    const parsedTtlDays = ttlEnv ? parseInt(ttlEnv, 10) : undefined;
    const idempotencyTtlDays = Number.isFinite(parsedTtlDays) && (parsedTtlDays as number) > 0
        ? (parsedTtlDays as number)
        : undefined;

    const thoughtLog = createThoughtLogService({
        owner,
        repo,
        defaultLabels: process.env.DEFAULT_LABELS || "thoughtlog",
        githubAppId: process.env.GITHUB_APP_ID,
        githubInstallationId: process.env.GITHUB_INSTALLATION_ID,
        githubPrivateKeySecretArn: process.env.GITHUB_PRIVATE_KEY_SECRET_ARN,
        idempotencyTable: process.env.IDEMPOTENCY_TABLE,
        idempotencyTtlDays,
    });

    const request = new LambdaHttpRequest(event);
    const router = new ThoughtLogRouter(thoughtLog);
    const response = await router.handle(request);
    return toLambdaResult(response);
};
