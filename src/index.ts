import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { githubRequest } from "./utils/http";
import { GitHubAuthService } from "./services/authService";
import { GitHubApiService } from "./services/githubService";
import { DynamoDBIdempotencyService } from "./services/idempotencyService";
import { ThoughtLogService } from "./services/thoughtLogService";

// DynamoDB client is created once at module load to reuse connections across invocations.
const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } },
);

export const handler = async (event: APIGatewayProxyEventV2 | APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const method = ("requestContext" in event && "http" in event.requestContext
        ? (event.requestContext as { http: { method: string } }).http.method
        : ("httpMethod" in event ? event.httpMethod : undefined)) || "POST";
    const rawPath = ("rawPath" in event ? event.rawPath : undefined) || ("path" in event ? event.path : undefined) || "";

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!owner || !repo) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_repo_env" }) };
    }

    const authService = new GitHubAuthService(
        process.env.GITHUB_APP_ID,
        process.env.GITHUB_INSTALLATION_ID,
        process.env.GITHUB_PRIVATE_KEY_PEM,
        githubRequest,
    );
    const githubService = new GitHubApiService(githubRequest);
    const idempotencyService = new DynamoDBIdempotencyService(ddb, process.env.IDEMPOTENCY_TABLE);
    const thoughtLog = new ThoughtLogService(authService, githubService, idempotencyService, {
        owner,
        repo,
        defaultLabels: process.env.DEFAULT_LABELS || "thoughtlog",
    });

    // GET /log/yyyy-mm-dd
    const dateMatch = rawPath.match(/\/log\/(\d{4}-\d{2}-\d{2})$/);
    if (method === "GET" && dateMatch) {
        try {
            const outcome = await thoughtLog.getLog(dateMatch[1]);
            if (outcome.kind === "not_found") {
                return { statusCode: 404, body: JSON.stringify({ ok: false, error: "not_found", date: outcome.date }) };
            }
            return {
                statusCode: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: outcome.body,
            };
        } catch (e) {
            return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
        }
    }

    // PUT /log/yyyy-mm-dd
    if (method === "PUT" && dateMatch) {
        const rawBody = typeof event.body === "string" ? event.body : "";
        const decodedBody = event.isBase64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody;
        let putPayload: { raw?: string };
        try {
            putPayload = decodedBody ? JSON.parse(decodedBody) as { raw?: string } : {};
        } catch (e) {
            return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_json", detail: (e as Error).message }) };
        }
        const newBody = (putPayload.raw ?? "").toString().trim();
        if (!newBody) {
            return { statusCode: 400, body: JSON.stringify({ ok: false, error: "missing_body" }) };
        }
        try {
            const outcome = await thoughtLog.updateLog(dateMatch[1], newBody);
            if (outcome.kind === "not_found") {
                return { statusCode: 404, body: JSON.stringify({ ok: false, error: "not_found", date: outcome.date }) };
            }
            return {
                statusCode: 200,
                body: JSON.stringify({ ok: true, date: outcome.date, issue_number: outcome.issue_number, issue_url: outcome.issue_url }),
            };
        } catch (e) {
            return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
        }
    }

    // POST /  – create a new log entry
    let payload: { request_id?: string; captured_at?: string; raw?: string; kind?: string; labels?: unknown[] } = {};
    try {
        if (typeof event.body === "string") payload = JSON.parse(event.body) as typeof payload;
        else if (typeof event.body === "object" && event.body) payload = event.body as unknown as typeof payload;
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_json", detail: (e as Error).message }) };
    }

    const requestId = (payload.request_id || "").toString().trim();
    if (!requestId) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "missing_request_id" }) };
    }

    try {
        const outcome = await thoughtLog.createEntry(payload);
        if (outcome.kind === "idempotent") {
            return { statusCode: outcome.statusCode, body: JSON.stringify(outcome.body) };
        }
        return {
            statusCode: 201,
            body: JSON.stringify({
                ok: true,
                date: outcome.date,
                issue_number: outcome.issue_number,
                issue_url: outcome.issue_url,
                comment_id: outcome.comment_id,
            }),
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
    }
};
