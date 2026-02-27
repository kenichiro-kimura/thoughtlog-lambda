import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThoughtLogService } from "./thoughtLogService";
import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { IIdempotencyService } from "../interfaces/IIdempotencyService";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";
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

function makeTextRefiner(refined = "refined text"): ITextRefinerService {
    return { refine: vi.fn().mockResolvedValue(refined) };
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

    it("refines raw text with textRefiner when source is voice", async () => {
        const textRefiner = makeTextRefiner("refined text");
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, textRefiner);
        await svc.createEntry({ request_id: "req-voice", raw: "raw voice text", source: "voice" });
        expect(textRefiner.refine).toHaveBeenCalledWith("raw voice text");
        const addCommentCall = (github.addComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(addCommentCall.commentBody).toContain("refined text");
    });

    it("throws when source is voice but no textRefiner is configured", async () => {
        await expect(
            service.createEntry({ request_id: "req-voice-err", raw: "raw voice text", source: "voice" }),
        ).rejects.toThrow("Text refiner is not configured");
    });

    it("does not call textRefiner when source is not voice", async () => {
        const textRefiner = makeTextRefiner();
        const svc = new ThoughtLogService(makeAuth(), github, idempotency, config, textRefiner);
        await svc.createEntry({ request_id: "req-normal", raw: "normal text" });
        expect(textRefiner.refine).not.toHaveBeenCalled();
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

    it("does not call textRefiner", async () => {
        const textRefiner = makeTextRefiner();
        const service = new ThoughtLogService(makeAuth(), makeGitHub(), makeIdempotency(), config, textRefiner);
        await service.updateLog("2024-01-15", "regular text");
        expect(textRefiner.refine).not.toHaveBeenCalled();
    });
});
