import crypto from "crypto";
import type { Payload, GitHubIssue } from "../types";
import { getDateKeyJst } from "../utils/date";
import { parseLabels, formatEntry } from "../utils/format";
import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { IIdempotencyService } from "../interfaces/IIdempotencyService";

export interface ThoughtLogConfig {
    owner: string;
    repo: string;
    defaultLabels: string;
}

// ── Result discriminated unions ────────────────────────────────────────────────

export type CreateEntryOutcome =
    | { kind: "created"; date: string; issue_number: number; issue_url: string; comment_id: number }
    | { kind: "idempotent"; statusCode: number; body: { ok: boolean; error?: string; idempotent?: boolean; issue_number?: number; issue_url?: string; comment_id?: number; status?: string } };

export type GetLogOutcome =
    | { kind: "found"; body: string }
    | { kind: "not_found"; date: string };

export type UpdateLogOutcome =
    | { kind: "updated"; date: string; issue_number: number; issue_url: string }
    | { kind: "not_found"; date: string };

/**
 * Orchestrates ThoughtLog business logic.
 * Depends only on interfaces so all external I/O can be replaced with test doubles.
 */
export class ThoughtLogService {
    constructor(
        private readonly auth: IAuthService,
        private readonly github: IGitHubService,
        private readonly idempotency: IIdempotencyService,
        private readonly config: ThoughtLogConfig,
    ) {}

    async createEntry(payload: Payload): Promise<CreateEntryOutcome> {
        const { owner, repo } = this.config;

        const requestId = (payload.request_id || "").toString().trim();
        if (!requestId) {
            throw new Error("request_id must be a non-empty string");
        }

        const dateKey = getDateKeyJst(payload);
        const labels = parseLabels(this.config.defaultLabels, payload.labels);
        const entry = formatEntry(payload);

        const payloadHash = crypto
            .createHash("sha256")
            .update(JSON.stringify({ dateKey, entry, labels }))
            .digest("hex");

        const idem = await this.idempotency.claim(requestId, payloadHash);
        if (idem.enabled && !idem.claimed) {
            return { kind: "idempotent", statusCode: idem.statusCode!, body: idem.body! };
        }

        try {
            const token = await this.auth.getInstallationToken();

            let issue: GitHubIssue | null = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
            if (!issue) {
                issue = await this.github.createDailyIssue({ owner, repo, dateKey, labels, token });
            } else if (!issue.html_url) {
                issue = await this.github.getIssue({ owner, repo, issueNumber: issue.number, token });
            }

            const comment = await this.github.addComment({
                owner, repo, issueNumber: issue.number, commentBody: entry, token,
            });

            await this.idempotency.markDone(requestId, {
                issue_number: issue.number,
                issue_url: issue.html_url!,
                comment_id: comment.id,
            });

            return {
                kind: "created",
                date: dateKey,
                issue_number: issue.number,
                issue_url: issue.html_url!,
                comment_id: comment.id,
            };
        } catch (e) {
            await this.idempotency.markFailed(requestId, (e as Error).message);
            throw e;
        }
    }

    async getLog(dateKey: string): Promise<GetLogOutcome> {
        const { owner, repo } = this.config;
        const token = await this.auth.getInstallationToken();
        const labels = parseLabels(this.config.defaultLabels, []);

        const issue = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        if (!issue) return { kind: "not_found", date: dateKey };

        const comments = await this.github.getIssueComments({ owner, repo, issueNumber: issue.number, token });
        return { kind: "found", body: comments.map((c) => c.body || "").join("\n") };
    }

    async updateLog(dateKey: string, newBody: string): Promise<UpdateLogOutcome> {
        const { owner, repo } = this.config;
        const token = await this.auth.getInstallationToken();
        const labels = parseLabels(this.config.defaultLabels, []);

        const issue = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        if (!issue) return { kind: "not_found", date: dateKey };

        await this.github.updateIssue({ owner, repo, issueNumber: issue.number, body: newBody, token });
        const closed = await this.github.closeIssue({ owner, repo, issueNumber: issue.number, token });

        return {
            kind: "updated",
            date: dateKey,
            issue_number: closed.number,
            issue_url: closed.html_url!,
        };
    }
}
