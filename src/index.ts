import crypto from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }
);

interface Payload {
    request_id?: string;
    captured_at?: string;
    raw?: string;
    kind?: string;
    labels?: unknown[];
}

interface IdempotencyItem {
    request_id: string;
    status: string;
    payload_hash?: string;
    issue_number?: number;
    issue_url?: string;
    comment_id?: number;
}

interface IdempotencyResult {
    enabled: boolean;
    claimed: boolean;
    statusCode?: number;
    body?: {
        ok: boolean;
        error?: string;
        idempotent?: boolean;
        issue_number?: number;
        issue_url?: string;
        comment_id?: number;
        status?: string;
    };
}

interface GitHubIssue {
    number: number;
    html_url: string;
    title?: string;
}

interface GitHubComment {
    id: number;
    body?: string;
}

interface GitHubSearchResult {
    items?: GitHubIssue[];
}

interface GitHubRequestOptions {
    method?: string;
    token?: string;
    body?: unknown;
}

function base64url(input: string | Buffer): string {
    return Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function signJwtRS256(payloadObj: object, privateKeyPem: string): string {
    const header = { alg: "RS256", typ: "JWT" };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payloadObj));
    const data = `${headerB64}.${payloadB64}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(data);
    signer.end();

    const signature = signer.sign(privateKeyPem);
    const sigB64 = base64url(signature);
    return `${data}.${sigB64}`;
}

function normalizePem(pemRaw: string | undefined): string | undefined {
    if (!pemRaw) return pemRaw;

    // common fixes
    let pem = pemRaw.trim().replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n");

    // if still single-line, re-wrap
    if (!pem.includes("\n")) {
        const headerMatch = pem.match(/-----BEGIN [^-]+-----/);
        const footerMatch = pem.match(/-----END [^-]+-----/);
        if (!headerMatch || !footerMatch) return pem;

        const header = headerMatch[0];
        const footer = footerMatch[0];

        let body = pem.replace(header, "").replace(footer, "").replace(/\s+/g, "");
        body = body.match(/.{1,64}/g) ? body.match(/.{1,64}/g)!.join("\n") : body;

        pem = `${header}\n${body}\n${footer}\n`;
    }
    return pem;
}

async function githubRequest(url: string, { method = "GET", token, body }: GitHubRequestOptions = {}): Promise<unknown> {
    const res = await fetch(url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/vnd.github+json",
            "User-Agent": "thoughtlog-lambda",
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }

    if (!res.ok) {
        throw new Error(`GitHub API ${res.status}: ${JSON.stringify(json)}`);
    }
    return json;
}

async function getInstallationToken(): Promise<string> {
    const appId = process.env.GITHUB_APP_ID;
    const installationId = process.env.GITHUB_INSTALLATION_ID;
    const privateKeyPem = normalizePem(process.env.GITHUB_PRIVATE_KEY_PEM);

    if (!appId || !installationId || !privateKeyPem) {
        throw new Error("Missing env: GITHUB_APP_ID / GITHUB_INSTALLATION_ID / GITHUB_PRIVATE_KEY_PEM");
    }

    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwtRS256({ iat: now - 30, exp: now + 8 * 60, iss: Number(appId) },
        privateKeyPem
    );

    const tokenResp = await githubRequest(
        `https://api.github.com/app/installations/${installationId}/access_tokens`, { method: "POST", token: jwt }
    ) as { token: string };

    return tokenResp.token;
}

function nowEpoch(): number {
    return Math.floor(Date.now() / 1000);
}

function parseLabels(defaultLabelsCsv: string, payloadLabels: unknown[]): string[] {
    const base = (defaultLabelsCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const extra = Array.isArray(payloadLabels) ?
        payloadLabels.map((s) => String(s).trim()).filter(Boolean) : [];

    // dedupe
    return [...new Set([...base, ...extra])];
}

/**
 * Decide date key (YYYY-MM-DD, JST).
 * payload.captured_at can be ISO string; if missing, use now.
 */
function getDateKeyJst(payload: Payload): string {
    const captured = payload?.captured_at ? new Date(payload.captured_at) : new Date();
    // Convert to JST date key
    const jstMs = captured.getTime() + 9 * 60 * 60 * 1000;
    const d = new Date(jstMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatEntry(payload: Payload): string {
    const captured = payload?.captured_at ? new Date(payload.captured_at) : new Date();
    const jst = new Date(captured.getTime() + 9 * 60 * 60 * 1000);
    const hh = String(jst.getUTCHours()).padStart(2, "0");
    const mi = String(jst.getUTCMinutes()).padStart(2, "0");

    const raw = (payload?.raw ?? "").toString().trim();
    const kind = (payload?.kind ?? "").toString().trim(); // optional
    const prefix = kind ? `**[${kind}]** ` : "";

    // コメントはMarkdownで：時刻見出し + 本文
    return `## ${hh}:${mi}\n${prefix}${raw}\n`;
}

/** Idempotency: ensure we only process request_id once. Optional. */
async function claimIdempotency(requestId: string, payloadHash: string): Promise<IdempotencyResult> {
    const table = process.env.IDEMPOTENCY_TABLE;
    if (!table) return { enabled: false, claimed: true };

    const ttlDays = Number(process.env.IDEMPOTENCY_TTL_DAYS || "14");
    const ttl = nowEpoch() + ttlDays * 24 * 60 * 60;

    try {
        await ddb.send(new PutCommand({
            TableName: table,
            Item: {
                request_id: requestId,
                status: "processing",
                payload_hash: payloadHash,
                created_at: nowEpoch(),
                ttl,
            },
            ConditionExpression: "attribute_not_exists(request_id)",
        }));
        return { enabled: true, claimed: true };
    } catch (e) {
        if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;

        const existing = await ddb.send(new GetCommand({
            TableName: table,
            Key: { request_id: requestId },
        }));

        const item = existing.Item as IdempotencyItem | undefined;
        if (!item) return { enabled: true, claimed: false, statusCode: 409, body: { ok: false, error: "idempotency_race_retry" } };

        if (item.payload_hash && item.payload_hash !== payloadHash) {
            return { enabled: true, claimed: false, statusCode: 409, body: { ok: false, error: "request_id_reused_with_different_payload" } };
        }

        if (item.status === "done") {
            return {
                enabled: true,
                claimed: false,
                statusCode: 200,
                body: {
                    ok: true,
                    idempotent: true,
                    issue_number: item.issue_number,
                    issue_url: item.issue_url,
                    comment_id: item.comment_id,
                },
            };
        }

        return { enabled: true, claimed: false, statusCode: 202, body: { ok: true, idempotent: true, status: item.status || "processing" } };
    }
}

async function markIdempotencyDone(requestId: string, { issue_number, issue_url, comment_id }: { issue_number: number; issue_url: string; comment_id: number }): Promise<void> {
    const table = process.env.IDEMPOTENCY_TABLE;
    if (!table) return;

    await ddb.send(new UpdateCommand({
        TableName: table,
        Key: { request_id: requestId },
        UpdateExpression: "SET #s = :done, issue_number = :n, issue_url = :u, comment_id = :c",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
            ":done": "done",
            ":n": issue_number,
            ":u": issue_url,
            ":c": comment_id,
        },
    }));
}

async function markIdempotencyFailed(requestId: string, errMsg: string): Promise<void> {
    const table = process.env.IDEMPOTENCY_TABLE;
    if (!table) return;

    try {
        await ddb.send(new UpdateCommand({
            TableName: table,
            Key: { request_id: requestId },
            UpdateExpression: "SET #s = :fail, error = :err",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":fail": "failed",
                ":err": String(errMsg).slice(0, 900),
            },
        }));
    } catch {}
}

async function getIssueComments({ token, owner, repo, issueNumber }: { token: string; owner: string; repo: string; issueNumber: number }): Promise<GitHubComment[]> {
    const comments: GitHubComment[] = [];
    let page = 1;
    while (true) {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`;
        const batch = await githubRequest(url, { token }) as GitHubComment[];
        if (!batch || batch.length === 0) break;
        comments.push(...batch);
        if (batch.length < 100) break;
        page++;
    }
    return comments;
}

async function findDailyIssue({ token, owner, repo, dateKey, labels }: { token: string; owner: string; repo: string; dateKey: string; labels: string[] }): Promise<GitHubIssue | null> {
    // Search Issues API (works for private repos with installation token)
    // We avoid daily labels; we search by title.
    // label filter uses the first default label if present (e.g., thoughtlog) to avoid accidental matches.
    const primaryLabel = labels.includes("thoughtlog") ? "thoughtlog" : labels[0]; // optional
    const qParts = [
        `repo:${owner}/${repo}`,
        `is:issue`,
        `state:open`,
        `in:title`,
        `"${dateKey}"`,
    ];
    if (primaryLabel) qParts.push(`label:${primaryLabel}`);
    const q = qParts.join(" ");

    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=5`;
    const result = await githubRequest(url, { token }) as GitHubSearchResult;

    const items = result?.items ?? [];
    // Exact title match only
    const exact = items.find((it) => (it.title || "").trim() === dateKey);
    return exact ?? null;
}

async function createDailyIssue({ token, owner, repo, dateKey, labels }: { token: string; owner: string; repo: string; dateKey: string; labels: string[] }): Promise<GitHubIssue> {
    const body = `# ${dateKey}\n\n<!-- summary will be generated later -->\n`;
    const issue = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST",
        token,
        body: { title: dateKey, body, labels },
    }) as GitHubIssue;
    return issue;
}

async function addComment({ token, owner, repo, issueNumber, commentBody }: { token: string; owner: string; repo: string; issueNumber: number; commentBody: string }): Promise<GitHubComment> {
    const comment = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
            method: "POST",
            token,
            body: { body: commentBody },
        }
    ) as GitHubComment;
    return comment;
}

async function updateIssue({ token, owner, repo, issueNumber, body }: { token: string; owner: string; repo: string; issueNumber: number; body: string }): Promise<GitHubIssue> {
    const issue = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
            method: "PATCH",
            token,
            body: { body },
        }
    ) as GitHubIssue;
    return issue;
}

async function closeIssue({ token, owner, repo, issueNumber }: { token: string; owner: string; repo: string; issueNumber: number }): Promise<GitHubIssue> {
    const issue = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
            method: "PATCH",
            token,
            body: { state: "closed" },
        }
    ) as GitHubIssue;
    return issue;
}

export const handler = async (event: APIGatewayProxyEventV2 | APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const method = ("requestContext" in event && "http" in event.requestContext
        ? (event.requestContext as { http: { method: string } }).http.method
        : ("httpMethod" in event ? event.httpMethod : undefined)) || "POST";
    const rawPath = ("rawPath" in event ? event.rawPath : undefined) || ("path" in event ? event.path : undefined) || "";

    // GET /log/yyyy-mm-dd
    const dateMatch = rawPath.match(/\/log\/(\d{4}-\d{2}-\d{2})$/);
    if (method === "GET" && dateMatch) {
        const dateKey = dateMatch[1];
        const owner = process.env.GITHUB_OWNER;
        const repo = process.env.GITHUB_REPO;
        if (!owner || !repo) {
            return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_repo_env" }) };
        }
        try {
            const installationToken = await getInstallationToken();
            const labels = parseLabels(process.env.DEFAULT_LABELS || "thoughtlog", []);
            const issue = await findDailyIssue({ token: installationToken, owner, repo, dateKey, labels });
            if (!issue) {
                return { statusCode: 404, body: JSON.stringify({ ok: false, error: "not_found", date: dateKey }) };
            }
            const comments = await getIssueComments({ token: installationToken, owner, repo, issueNumber: issue.number });
            const body = comments.map((c) => c.body || "").join("\n");
            return {
                statusCode: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body,
            };
        } catch (e) {
            return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
        }
    }

    // PUT /log/yyyy-mm-dd
    if (method === "PUT" && dateMatch) {
        const dateKey = dateMatch[1];
        const owner = process.env.GITHUB_OWNER;
        const repo = process.env.GITHUB_REPO;
        if (!owner || !repo) {
            return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_repo_env" }) };
        }
        const rawBody = typeof event.body === "string" ? event.body : "";
        const decodedBody = event.isBase64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody;
        let putPayload: { raw?: string } = {};
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
            const installationToken = await getInstallationToken();
            const labels = parseLabels(process.env.DEFAULT_LABELS || "thoughtlog", []);
            const issue = await findDailyIssue({ token: installationToken, owner, repo, dateKey, labels });
            if (!issue) {
                return { statusCode: 404, body: JSON.stringify({ ok: false, error: "not_found", date: dateKey }) };
            }
            await updateIssue({ token: installationToken, owner, repo, issueNumber: issue.number, body: newBody });
            const closed = await closeIssue({ token: installationToken, owner, repo, issueNumber: issue.number });
            return {
                statusCode: 200,
                body: JSON.stringify({ ok: true, date: dateKey, issue_number: closed.number, issue_url: closed.html_url }),
            };
        } catch (e) {
            return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
        }
    }

    // Robust payload read
    let payload: Payload = {};
    try {
        if (typeof event.body === "string") payload = JSON.parse(event.body) as Payload;
        else if (typeof event.body === "object" && event.body) payload = event.body as unknown as Payload;
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_json", detail: (e as Error).message }) };
    }

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!owner || !repo) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_repo_env" }) };
    }

    const requestId = (payload.request_id || "").toString().trim();
    if (!requestId) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "missing_request_id" }) };
    }

    const dateKey = getDateKeyJst(payload);
    const labels = parseLabels(process.env.DEFAULT_LABELS || "thoughtlog", payload.labels ?? []);
    const entry = formatEntry(payload);

    // Hash for idempotency safety (same request_id must mean same content)
    const payloadHash = crypto
        .createHash("sha256")
        .update(JSON.stringify({ dateKey, entry, labels }))
        .digest("hex");

    // Optional idempotency
    let idem: IdempotencyResult;
    try {
        idem = await claimIdempotency(requestId, payloadHash);
        if (idem.enabled && !idem.claimed) {
            return { statusCode: idem.statusCode!, body: JSON.stringify(idem.body) };
        }
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: `idempotency_error:${(e as Error).message}` }) };
    }

    try {
        const installationToken = await getInstallationToken();

        // 1) find issue by title, else create
        let issue = await findDailyIssue({ token: installationToken, owner, repo, dateKey, labels });
        if (!issue) {
            issue = await createDailyIssue({ token: installationToken, owner, repo, dateKey, labels });
        } else {
            // Search API returns limited fields, but has number/html_url usually.
            // If missing, fetch full issue:
            if (!issue.number || !issue.html_url) {
                const full = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}`, {
                    token: installationToken,
                }) as GitHubIssue;
                issue = full;
            }
        }

        // 2) add comment
        const comment = await addComment({
            token: installationToken,
            owner,
            repo,
            issueNumber: issue.number,
            commentBody: entry,
        });

        // 3) mark idempotency done
        await markIdempotencyDone(requestId, {
            issue_number: issue.number,
            issue_url: issue.html_url,
            comment_id: comment.id,
        });

        return {
            statusCode: 201,
            body: JSON.stringify({
                ok: true,
                date: dateKey,
                issue_number: issue.number,
                issue_url: issue.html_url,
                comment_id: comment.id,
            }),
        };
    } catch (e) {
        await markIdempotencyFailed(requestId, (e as Error).message);
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) };
    }
};
