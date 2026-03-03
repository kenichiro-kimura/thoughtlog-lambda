import { describe, it, expect, vi, afterEach } from "vitest";
import { IssueFinalizeService, FINALIZE_JSON_FORMAT_APPENDIX } from "./finalizeService";
import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";
import type { GitHubIssue, GitHubComment, FinalizeMessage } from "../types";

// ── test doubles ───────────────────────────────────────────────────────────────

const mockIssue: GitHubIssue = { number: 10, html_url: "https://github.com/o/r/issues/10", title: "2024-03-01" };
const mockComments: GitHubComment[] = [
    { id: 1, body: "## 09:00\nfirst thought\n" },
    { id: 2, body: "## 10:30\nsecond thought\n" },
];

const validOpenAiResponse = JSON.stringify({ title: "Daily summary", body: "# Summary\n\nAll thoughts." });

function makeAuth(token = "tok"): IAuthService {
    return { getInstallationToken: vi.fn().mockResolvedValue(token) };
}

function makeGitHub(overrides: Partial<IGitHubService> = {}): IGitHubService {
    return {
        findDailyIssue: vi.fn().mockResolvedValue(mockIssue),
        createDailyIssue: vi.fn().mockResolvedValue(mockIssue),
        addComment: vi.fn().mockResolvedValue({ id: 99 }),
        updateIssue: vi.fn().mockResolvedValue(mockIssue),
        closeIssue: vi.fn().mockResolvedValue(mockIssue),
        getIssueComments: vi.fn().mockResolvedValue(mockComments),
        getIssue: vi.fn().mockResolvedValue(mockIssue),
        getComment: vi.fn().mockResolvedValue({ id: 1, body: "comment" }),
        updateComment: vi.fn().mockResolvedValue({ id: 1 }),
        ...overrides,
    };
}

function makeTextRefiner(response = validOpenAiResponse): ITextRefinerService {
    return { refine: vi.fn().mockResolvedValue(response) };
}

const message: FinalizeMessage = {
    type: "finalize",
    owner: "owner",
    repo: "repo",
    dateKey: "2024-03-01",
    labels: ["thoughtlog"],
    issueNumber: 10,
};

// ── IssueFinalizeService ───────────────────────────────────────────────────────

describe("IssueFinalizeService.finalize", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fetches comments, calls refiner, updates and closes the issue", async () => {
        const github = makeGitHub();
        const textRefiner = makeTextRefiner();
        const svc = new IssueFinalizeService(makeAuth(), github, textRefiner);

        await svc.finalize(message);

        expect(github.findDailyIssue).not.toHaveBeenCalled();
        expect(github.getIssueComments).toHaveBeenCalledWith({
            owner: "owner", repo: "repo", issueNumber: 10, token: "tok",
        });
        expect(textRefiner.refine).toHaveBeenCalledOnce();
        expect(github.updateIssue).toHaveBeenCalledOnce();
        expect(github.addComment).toHaveBeenCalledTimes(2);
        expect(github.closeIssue).toHaveBeenCalledWith({
            owner: "owner", repo: "repo", issueNumber: 10, token: "tok",
        });
    });

    it("posts a content comment then a finalize datetime comment before closing", async () => {
        vi.spyOn(Date, "now").mockReturnValue(new Date("2024-03-01T10:00:00Z").getTime());
        const github = makeGitHub();
        const svc = new IssueFinalizeService(makeAuth(), github, makeTextRefiner());

        await svc.finalize(message);

        const calls = (github.addComment as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][0].commentBody).toBe("# 2024-03-01 Daily summary\n\n# Summary\n\nAll thoughts.");
        expect(calls[1][0].commentBody).toBe("finalizeしました(2024-03-01 19:00)");
        const addCommentOrder = (github.addComment as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
        const closeIssueOrder = (github.closeIssue as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
        expect(Math.max(...addCommentOrder)).toBeLessThan(Math.min(...closeIssueOrder));
    });

    it("prepends dateKey to title when not already present", async () => {
        const github = makeGitHub();
        const textRefiner = makeTextRefiner(JSON.stringify({ title: "Daily summary", body: "body text" }));
        const svc = new IssueFinalizeService(makeAuth(), github, textRefiner);

        await svc.finalize(message);

        const updateCall = (github.updateIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(updateCall.title).toBe("2024-03-01 Daily summary");
        expect(updateCall.body).toBe("body text");
    });

    it("does not double-prepend dateKey when title already starts with it", async () => {
        const github = makeGitHub();
        const textRefiner = makeTextRefiner(JSON.stringify({ title: "2024-03-01 Summary", body: "body" }));
        const svc = new IssueFinalizeService(makeAuth(), github, textRefiner);

        await svc.finalize(message);

        const updateCall = (github.updateIssue as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(updateCall.title).toBe("2024-03-01 Summary");
    });

    it("concatenates comment bodies separated by blank line before passing to refiner", async () => {
        const github = makeGitHub();
        const textRefiner = makeTextRefiner();
        const svc = new IssueFinalizeService(makeAuth(), github, textRefiner);

        await svc.finalize(message);

        const refineArg = (textRefiner.refine as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(refineArg).toContain("first thought");
        expect(refineArg).toContain("second thought");
    });

    it("treats undefined comment body as empty string", async () => {
        const github = makeGitHub({
            getIssueComments: vi.fn().mockResolvedValue([{ id: 1, body: undefined }]),
        });
        const textRefiner = makeTextRefiner();
        const svc = new IssueFinalizeService(makeAuth(), github, textRefiner);

        await svc.finalize(message);

        const refineArg = (textRefiner.refine as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(refineArg).toBe("");
    });

    it("throws when OpenAI response is not valid JSON", async () => {
        const textRefiner = makeTextRefiner("not valid json");
        const svc = new IssueFinalizeService(makeAuth(), makeGitHub(), textRefiner);

        await expect(svc.finalize(message)).rejects.toThrow("Failed to parse OpenAI response as JSON");
    });

    it("throws when OpenAI JSON is missing required fields", async () => {
        const textRefiner = makeTextRefiner(JSON.stringify({ title: "only title" }));
        const svc = new IssueFinalizeService(makeAuth(), makeGitHub(), textRefiner);

        await expect(svc.finalize(message)).rejects.toThrow("OpenAI response missing required fields");
    });
});

// ── FINALIZE_JSON_FORMAT_APPENDIX ──────────────────────────────────────────────

describe("FINALIZE_JSON_FORMAT_APPENDIX", () => {
    it("is a non-empty string containing JSON format instructions", () => {
        expect(typeof FINALIZE_JSON_FORMAT_APPENDIX).toBe("string");
        expect(FINALIZE_JSON_FORMAT_APPENDIX.length).toBeGreaterThan(0);
        expect(FINALIZE_JSON_FORMAT_APPENDIX).toContain("title");
        expect(FINALIZE_JSON_FORMAT_APPENDIX).toContain("body");
    });
});
