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
    it("updates and closes issue, returning updated outcome", async () => {
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config);
        const outcome = await service.updateLog("2024-01-15", "summary text");
        expect(outcome.kind).toBe("updated");
        if (outcome.kind === "updated") {
            expect(outcome.issue_number).toBe(42);
        }
    });

    it("returns not_found outcome when no issue exists", async () => {
        const github = makeGitHub({ findDailyIssue: vi.fn().mockResolvedValue(null) });
        const service = new ThoughtLogService(makeAuth(), github, makeIdempotency(), config);
        const outcome = await service.updateLog("2024-01-15", "text");
        expect(outcome.kind).toBe("not_found");
    });

    it("does not send queue message", async () => {
        const queue = makeQueue();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, queue);
        await service.updateLog("2024-01-15", "regular text");
        expect(queue.sendMessage).not.toHaveBeenCalled();
    });
});

