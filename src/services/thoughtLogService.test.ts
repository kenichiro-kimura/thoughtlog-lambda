import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThoughtLogService } from "./thoughtLogService";
import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { IIdempotencyService } from "../interfaces/IIdempotencyService";
import type { IQueueService } from "../interfaces/IQueueService";
import type { GitHubIssue, GitHubComment } from "../types";

// ── shared test doubles ────────────────────────────────────────────────────────

const mockIssue: GitHubIssue = { number: 42, html_url: "https://github.com/owner/repo/issues/42", title: "2024-01-15" };
const mockComment: GitHubComment = { id: 99, body: "## 19:30\nhello\n" };

function makeAuth(token = "tok"): IAuthService {
    return { getInstallationToken: vi.fn().mockResolvedValue(token) };
}

function makeGitHub(overrides: Partial<IGitHubService> = {}): IGitHubService {
    return {
        findDailyIssue: vi.fn().mockResolvedValue(mockIssue),
        createDailyIssue: vi.fn().mockResolvedValue(mockIssue),
        addComment: vi.fn().mockResolvedValue(mockComment),
        updateIssue: vi.fn().mockResolvedValue(mockIssue),
        closeIssue: vi.fn().mockResolvedValue(mockIssue),
        getIssueComments: vi.fn().mockResolvedValue([mockComment]),
        getIssue: vi.fn().mockResolvedValue(mockIssue),
        getComment: vi.fn().mockResolvedValue(mockComment),
        updateComment: vi.fn().mockResolvedValue(mockComment),
        ...overrides,
    };
}

function makeIdempotency(overrides: Partial<IIdempotencyService> = {}): IIdempotencyService {
    return {
        claim: vi.fn().mockResolvedValue({ enabled: false, claimed: true }),
        markDone: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
        getIssueNumberByTitle: vi.fn().mockResolvedValue(null),
        putIssueTitleCache: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeQueue(): IQueueService {
    return { sendMessage: vi.fn().mockResolvedValue(undefined) };
}

const config = { owner: "owner", repo: "repo", defaultLabels: "thoughtlog" };

// ── createEntry ────────────────────────────────────────────────────────────────

describe("ThoughtLogService.createEntry", () => {
    let auth: IAuthService;
    let github: IGitHubService;
    let idempotency: IIdempotencyService;
    let service: ThoughtLogService;

    beforeEach(() => {
        auth = makeAuth();
        github = makeGitHub();
        idempotency = makeIdempotency();
        service = new ThoughtLogService(auth, github, idempotency, config);
    });

    it("throws when request_id is empty", async () => {
        await expect(
            service.createEntry({ raw: "hello" }),
        ).rejects.toThrow("request_id must be a non-empty string");
        expect(idempotency.claim).not.toHaveBeenCalled();
    });

    it("creates a new entry and returns created outcome", async () => {
        const outcome = await service.createEntry({
            request_id: "req-1",
            raw: "hello",
            captured_at: "2024-01-15T10:30:00Z",
        });

        expect(outcome.kind).toBe("created");
        if (outcome.kind === "created") {
            expect(outcome.issue_number).toBe(42);
            expect(outcome.comment_id).toBe(99);
        }
        expect(github.findDailyIssue).toHaveBeenCalledOnce();
        expect(github.addComment).toHaveBeenCalledOnce();
        expect(idempotency.markDone).toHaveBeenCalledOnce();
    });

    it("creates a daily issue when none exists", async () => {
        (github.findDailyIssue as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const outcome = await service.createEntry({ request_id: "req-2", raw: "new", captured_at: "2024-01-15T10:30:00Z" });
        expect(outcome.kind).toBe("created");
        expect(github.createDailyIssue).toHaveBeenCalledOnce();
    });

    it("uses cached issue number from DynamoDB when available, skipping GitHub search", async () => {
        (idempotency.getIssueNumberByTitle as ReturnType<typeof vi.fn>).mockResolvedValue(42);
        const outcome = await service.createEntry({ request_id: "req-cached", raw: "hello", captured_at: "2024-01-15T10:30:00Z" });
        expect(outcome.kind).toBe("created");
        expect(github.findDailyIssue).not.toHaveBeenCalled();
        expect(github.getIssue).toHaveBeenCalledOnce();
        expect(github.addComment).toHaveBeenCalledOnce();
    });

    it("does not call putIssueTitleCache when cache hit", async () => {
        (idempotency.getIssueNumberByTitle as ReturnType<typeof vi.fn>).mockResolvedValue(42);
        await service.createEntry({ request_id: "req-cached2", raw: "hello", captured_at: "2024-01-15T10:30:00Z" });
        expect(idempotency.putIssueTitleCache).not.toHaveBeenCalled();
    });

    it("saves issue to cache after finding via GitHub search", async () => {
        await service.createEntry({ request_id: "req-save-cache", raw: "hello", captured_at: "2024-01-15T10:30:00Z" });
        expect(idempotency.putIssueTitleCache).toHaveBeenCalledOnce();
        const [, issueNumber] = (idempotency.putIssueTitleCache as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(issueNumber).toBe(42);
    });

    it("saves issue to cache after finding via GitHub search with correct title", async () => {
        await service.createEntry({ request_id: "req-save-cache-title", raw: "hello", captured_at: "2024-01-15T10:30:00Z" });
        expect(idempotency.putIssueTitleCache).toHaveBeenCalledOnce();
        const [title] = (idempotency.putIssueTitleCache as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(title).toContain("2024-01-15");
    });

    it("saves issue to cache after creating a new issue", async () => {
        (github.findDailyIssue as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        await service.createEntry({ request_id: "req-create-cache", raw: "new", captured_at: "2024-01-15T10:30:00Z" });
        expect(idempotency.putIssueTitleCache).toHaveBeenCalledOnce();
        const [, issueNumber] = (idempotency.putIssueTitleCache as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(issueNumber).toBe(42);
    });

    it("returns idempotent outcome when claim is not claimed", async () => {
        idempotency.claim = vi.fn().mockResolvedValue({
            enabled: true,
            claimed: false,
            statusCode: 200,
            body: { ok: true, idempotent: true, issue_number: 42 },
        });

        const outcome = await service.createEntry({ request_id: "req-dup", raw: "hello" });
        expect(outcome.kind).toBe("idempotent");
        if (outcome.kind === "idempotent") {
            expect(outcome.statusCode).toBe(200);
        }
        expect(github.addComment).not.toHaveBeenCalled();
    });

    it("marks idempotency failed and rethrows on GitHub error", async () => {
        (github.addComment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("gh error"));

        await expect(
            service.createEntry({ request_id: "req-err", raw: "fail" }),
        ).rejects.toThrow("gh error");

        expect(idempotency.markFailed).toHaveBeenCalledOnce();
    });

    it("creates entry with raw body when source is voice", async () => {
        const queue = makeQueue();
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, queue);
        await svc.createEntry({ request_id: "req-voice", raw: "raw voice text", source: "voice" });
        const addCommentCall = (github.addComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(addCommentCall.commentBody).toContain("raw voice text");
    });

    it("sends queue message with comment id when source is voice", async () => {
        const queue = makeQueue();
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, queue);
        await svc.createEntry({ request_id: "req-voice", raw: "raw voice text", source: "voice" });
        expect(queue.sendMessage).toHaveBeenCalledOnce();
        const msg = JSON.parse((queue.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        expect(msg.commentId).toBe(99);
        expect(msg.issueNumber).toBe(42);
        expect(msg.owner).toBe("owner");
        expect(msg.repo).toBe("repo");
    });

    it("does not send queue message when source is voice but no queueService is configured", async () => {
        // No queue service — creates entry with raw body, no error, no queue message
        const outcome = await service.createEntry({ request_id: "req-voice-noq", raw: "raw voice text", source: "voice" });
        expect(outcome.kind).toBe("created");
        const addCommentCall = (github.addComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(addCommentCall.commentBody).toContain("raw voice text");
    });

    it("does not send queue message when source is not voice", async () => {
        const queue = makeQueue();
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, queue);
        await svc.createEntry({ request_id: "req-normal", raw: "normal text" });
        expect(queue.sendMessage).not.toHaveBeenCalled();
    });

    it("succeeds and calls markDone even when queue send fails", async () => {
        const queue: IQueueService = { sendMessage: vi.fn().mockRejectedValue(new Error("SQS down")) };
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, queue);
        const outcome = await svc.createEntry({ request_id: "req-voice-qfail", raw: "raw voice text", source: "voice" });
        expect(outcome.kind).toBe("created");
        expect(idempotency.markDone).toHaveBeenCalledOnce();
        expect(idempotency.markFailed).not.toHaveBeenCalled();
    });

    it("calls markDone before queue send for voice entries", async () => {
        const callOrder: string[] = [];
        (idempotency.markDone as ReturnType<typeof vi.fn>).mockImplementation(async () => { callOrder.push("markDone"); });
        const queue: IQueueService = { sendMessage: vi.fn().mockImplementation(async () => { callOrder.push("sendMessage"); }) };
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, queue);
        await svc.createEntry({ request_id: "req-order", raw: "text", source: "voice" });
        expect(callOrder.indexOf("markDone")).toBeLessThan(callOrder.indexOf("sendMessage"));
    });
});

// ── getLog ─────────────────────────────────────────────────────────────────────

describe("ThoughtLogService.getLog", () => {
    it("returns found outcome with concatenated comment bodies", async () => {
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config);
        const outcome = await service.getLog("2024-01-15");
        expect(outcome.kind).toBe("found");
        if (outcome.kind === "found") {
            expect(outcome.body).toContain("hello");
        }
    });

    it("returns not_found outcome when no issue exists", async () => {
        const github = makeGitHub({ findDailyIssue: vi.fn().mockResolvedValue(null) });
        const service = new ThoughtLogService(makeAuth(), github, makeIdempotency(), config);
        const outcome = await service.getLog("2024-01-15");
        expect(outcome.kind).toBe("not_found");
        if (outcome.kind === "not_found") {
            expect(outcome.date).toBe("2024-01-15");
        }
    });
});

// ── updateLog ──────────────────────────────────────────────────────────────────

describe("ThoughtLogService.updateLog", () => {
    it("throws when no queue service is configured", async () => {
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config);
        await expect(service.updateLog("2024-01-15")).rejects.toThrow("Queue service not configured for finalize");
    });

    it("returns not_found when no issue exists for the date", async () => {
        const queue = makeQueue();
        const github = makeGitHub({ findDailyIssue: vi.fn().mockResolvedValue(null) });
        const service = new ThoughtLogService(makeAuth(), github, makeIdempotency(), config, queue);
        const outcome = await service.updateLog("2024-01-15");
        expect(outcome.kind).toBe("not_found");
        expect(queue.sendMessage).not.toHaveBeenCalled();
    });

    it("enqueues a finalize message and returns queued outcome", async () => {
        const queue = makeQueue();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, queue);
        const outcome = await service.updateLog("2024-01-15");
        expect(outcome.kind).toBe("queued");
        if (outcome.kind === "queued") {
            expect(outcome.date).toBe("2024-01-15");
        }
        expect(queue.sendMessage).toHaveBeenCalledOnce();
    });

    it("sends a finalize message with correct fields including issueNumber", async () => {
        const queue = makeQueue();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, queue);
        await service.updateLog("2024-01-15");
        const msg = JSON.parse((queue.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        expect(msg.type).toBe("finalize");
        expect(msg.owner).toBe("owner");
        expect(msg.repo).toBe("repo");
        expect(msg.dateKey).toBe("2024-01-15");
        expect(msg.issueNumber).toBe(42);
        expect(Array.isArray(msg.labels)).toBe(true);
    });
});

// ── enqueueEntry ───────────────────────────────────────────────────────────────

describe("ThoughtLogService.enqueueEntry", () => {
    it("throws when no create entry queue service is configured", async () => {
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config);
        await expect(service.enqueueEntry({ request_id: "req-1", raw: "hello" })).rejects.toThrow(
            "Create entry queue service not configured",
        );
    });

    it("sends create-entry message to queue and returns queued outcome", async () => {
        const createEntryQueue = makeQueue();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, undefined, createEntryQueue);
        const outcome = await service.enqueueEntry({ request_id: "req-1", raw: "hello" });
        expect(outcome.kind).toBe("queued");
        expect(createEntryQueue.sendMessage).toHaveBeenCalledOnce();
        const msg = JSON.parse((createEntryQueue.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        expect(msg.type).toBe("create-entry");
        expect(msg.payload.request_id).toBe("req-1");
    });

    it("returns too_large when payload exceeds 200KB", async () => {
        const createEntryQueue = makeQueue();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, undefined, createEntryQueue);
        const largeRaw = "x".repeat(200 * 1024);
        const outcome = await service.enqueueEntry({ request_id: "req-large", raw: largeRaw });
        expect(outcome.kind).toBe("too_large");
        expect(createEntryQueue.sendMessage).not.toHaveBeenCalled();
    });

    it("does not exceed limit for payload just under 200KB", async () => {
        const createEntryQueue = makeQueue();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, undefined, createEntryQueue);
        // Compute how many bytes the envelope uses with an empty raw field.
        // Adding `remaining` ASCII chars to raw increases the serialized message by exactly `remaining` bytes.
        // Final message size = emptyEnvelopeSize + remaining = 200 * 1024 - 1 (just under the limit).
        const emptyEnvelopeSize = Buffer.byteLength(
            JSON.stringify({ type: "create-entry", payload: { request_id: "r", raw: "" } }),
            "utf8",
        );
        const remaining = 200 * 1024 - emptyEnvelopeSize - 1;
        const outcome = await service.enqueueEntry({ request_id: "r", raw: "x".repeat(remaining) });
        expect(outcome.kind).toBe("queued");
    });
});

