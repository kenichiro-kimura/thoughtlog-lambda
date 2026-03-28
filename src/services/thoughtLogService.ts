import crypto from "crypto";
import type { Payload, GitHubIssue, RepositoryConfig, CreateEntryOutcome, EnqueueEntryOutcome, GetLogOutcome, GetLogBodyOutcome, GetLogCommentsOutcome, GetLogSummaryOutcome, UpdateLogOutcome, VoiceRefineMessage, FinalizeMessage, CreateEntryMessage } from "../types";
import { getDateKeyJst } from "../utils/date";
import { parseLabels, formatEntry } from "../utils/format";
import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { IIdempotencyService } from "../interfaces/IIdempotencyService";
import type { IThoughtLogService } from "../interfaces/IThoughtLogService";
import type { IQueueService } from "../interfaces/IQueueService";

export type { IThoughtLogService };
export type { CreateEntryOutcome, EnqueueEntryOutcome, GetLogOutcome, GetLogBodyOutcome, GetLogCommentsOutcome, GetLogSummaryOutcome, UpdateLogOutcome };

/**
 * Orchestrates ThoughtLog business logic.
 * Depends only on interfaces so all external I/O can be replaced with test doubles.
 */
export class ThoughtLogService implements IThoughtLogService {
    constructor(
        private readonly auth: IAuthService,
        private readonly github: IGitHubService,
        private readonly idempotency: IIdempotencyService,
        private readonly config: RepositoryConfig,
        private readonly queueService?: IQueueService,
        private readonly createEntryQueueService?: IQueueService,
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

            const cachedIssueNumber = await this.idempotency.getIssueNumberByTitle(dateKey);
            let issue: GitHubIssue;
            if (cachedIssueNumber !== null) {
                issue = await this.github.getIssue({ owner, repo, issueNumber: cachedIssueNumber, token });
            } else {
                const found = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
                if (found) {
                    issue = found.html_url ? found : await this.github.getIssue({ owner, repo, issueNumber: found.number, token });
                } else {
                    issue = await this.github.createDailyIssue({ owner, repo, dateKey, labels, token });
                }
                await this.idempotency.putIssueTitleCache(dateKey, issue.number);
            }

            const comment = await this.github.addComment({
                owner, repo, issueNumber: issue.number, commentBody: entry, token,
            });

            await this.idempotency.markDone(requestId, {
                issue_number: issue.number,
                issue_url: issue.html_url!,
                comment_id: comment.id,
            });

            if (payload.source === "voice" && this.queueService) {
                const message: VoiceRefineMessage = {
                    type: "voice-polish",
                    issueNumber: issue.number,
                    commentId: comment.id,
                };
                try {
                    await this.queueService.sendMessage(JSON.stringify(message));
                } catch (queueError) {
                    console.error("Failed to send voice refine message to queue:", queueError instanceof Error ? queueError.message : String(queueError));
                }
            }

            return {
                kind: "created",
                date: dateKey,
                issue_number: issue.number,
                issue_url: issue.html_url!,
                comment_id: comment.id,
            };
        } catch (e) {
            await this.idempotency.markFailed(requestId, e instanceof Error ? e.message : String(e));
            throw e;
        }
    }

    async enqueueEntry(payload: Payload): Promise<EnqueueEntryOutcome> {
        if (!this.createEntryQueueService) {
            throw new Error("Create entry queue service not configured");
        }
        const message: CreateEntryMessage = { type: "create-entry", payload };
        const messageBody = JSON.stringify(message);
        const MAX_BYTES = 200 * 1024;
        if (Buffer.byteLength(messageBody, "utf8") > MAX_BYTES) {
            return { kind: "too_large" };
        }
        await this.createEntryQueueService.sendMessage(messageBody);
        return { kind: "queued" };
    }

    async getLog(dateKey: string): Promise<GetLogOutcome> {
        const { owner, repo } = this.config;
        const token = await this.auth.getInstallationToken();
        const labels = parseLabels(this.config.defaultLabels, []);

        const issue = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        if (!issue) return { kind: "not_found", date: dateKey };

        return {
            kind: "found",
            id: `issue-id-${issue.number}`,
            date: dateKey,
            title: issue.title ?? dateKey,
            links: {
                body: `/log/${dateKey}/body`,
                comments: `/log/${dateKey}/comments`,
            },
        };
    }

    async getLogBody(dateKey: string): Promise<GetLogBodyOutcome> {
        const { owner, repo } = this.config;
        const token = await this.auth.getInstallationToken();
        const labels = parseLabels(this.config.defaultLabels, []);

        const found = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        if (!found) return { kind: "not_found", date: dateKey };

        const issue = await this.github.getIssue({ owner, repo, issueNumber: found.number, token });
        return { kind: "found", body: issue.body ?? "" };
    }

    async getLogComments(dateKey: string): Promise<GetLogCommentsOutcome> {
        const { owner, repo } = this.config;
        const token = await this.auth.getInstallationToken();
        const labels = parseLabels(this.config.defaultLabels, []);

        const issue = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        if (!issue) return { kind: "not_found", date: dateKey };

        const comments = await this.github.getIssueComments({ owner, repo, issueNumber: issue.number, token });
        return { kind: "found", comments: comments.map((c) => c.body ?? "") };
    }

    async getLogSummary(dateKey: string): Promise<GetLogSummaryOutcome> {
        const { owner, repo } = this.config;
        const token = await this.auth.getInstallationToken();

        const issue = await this.github.findIssueByTitlePrefix?.({ owner, repo, titlePrefix: `${dateKey} `, token }) ?? null;
        if (!issue) return { kind: "not_found", date: dateKey };

        const comments = await this.github.getIssueComments({ owner, repo, issueNumber: issue.number, token });
        // GitHub returns comments in ascending order; the second newest is at index length-2.
        const secondNewest = comments.length >= 2 ? comments[comments.length - 2] : null;
        if (!secondNewest) return { kind: "not_found", date: dateKey };

        return { kind: "found", summary: secondNewest.body ?? "" };
    }

    async updateLog(dateKey: string): Promise<UpdateLogOutcome> {
        if (!this.queueService) {
            throw new Error("Queue service not configured for finalize");
        }
        const message: FinalizeMessage = {
            type: "finalize",
            dateKey,
        };
        await this.queueService.sendMessage(JSON.stringify(message));
        return { kind: "queued", date: dateKey };
    }
}
