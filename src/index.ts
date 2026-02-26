import type { APIGatewayProxyEventV2, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Payload } from "./types";
import { createThoughtLogService } from "./container";
import { LambdaHttpRequest, HTTP_STATUS, buildJsonResult, buildTextResult } from "./adapters/lambdaAdapter";

export const handler = async (event: APIGatewayProxyEventV2 | APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const request = new LambdaHttpRequest(event);
    const method = request.getMethod();
    const dateParam = request.getDateParam();

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!owner || !repo) {
        return buildJsonResult(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: "missing_repo_env" });
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
        githubPrivateKeyPem: process.env.GITHUB_PRIVATE_KEY_PEM,
        idempotencyTable: process.env.IDEMPOTENCY_TABLE,
        idempotencyTtlDays,
    });

    // GET /log/yyyy-mm-dd
    if (method === "GET" && dateParam) {
        try {
            const outcome = await thoughtLog.getLog(dateParam);
            if (outcome.kind === "not_found") {
                return buildJsonResult(HTTP_STATUS.NOT_FOUND, { ok: false, error: "not_found", date: outcome.date });
            }
            return buildTextResult(outcome.body);
        } catch (e) {
            return buildJsonResult(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: (e as Error).message });
        }
    }

    // PUT /log/yyyy-mm-dd
    if (method === "PUT" && dateParam) {
        const decodedBody = request.getRawBody();
        let putPayload: { raw?: string };
        try {
            putPayload = decodedBody ? JSON.parse(decodedBody) as { raw?: string } : {};
        } catch (e) {
            return buildJsonResult(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "invalid_json", detail: (e as Error).message });
        }
        const newBody = (putPayload.raw ?? "").toString().trim();
        if (!newBody) {
            return buildJsonResult(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "missing_body" });
        }
        try {
            const outcome = await thoughtLog.updateLog(dateParam, newBody);
            if (outcome.kind === "not_found") {
                return buildJsonResult(HTTP_STATUS.NOT_FOUND, { ok: false, error: "not_found", date: outcome.date });
            }
            return buildJsonResult(HTTP_STATUS.OK, { ok: true, date: outcome.date, issue_number: outcome.issue_number, issue_url: outcome.issue_url });
        } catch (e) {
            return buildJsonResult(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: (e as Error).message });
        }
    }

    // POST /  – create a new log entry
    let payload: Payload;
    try {
        payload = request.getPayload();
    } catch (e) {
        return buildJsonResult(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "invalid_json", detail: (e as Error).message });
    }

    const requestId = (payload.request_id || "").toString().trim();
    if (!requestId) {
        return buildJsonResult(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "missing_request_id" });
    }

    try {
        const outcome = await thoughtLog.createEntry(payload);
        if (outcome.kind === "idempotent") {
            return buildJsonResult(outcome.statusCode, outcome.body);
        }
        return buildJsonResult(HTTP_STATUS.CREATED, {
            ok: true,
            date: outcome.date,
            issue_number: outcome.issue_number,
            issue_url: outcome.issue_url,
            comment_id: outcome.comment_id,
        });
    } catch (e) {
        return buildJsonResult(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: (e as Error).message });
    }
};
