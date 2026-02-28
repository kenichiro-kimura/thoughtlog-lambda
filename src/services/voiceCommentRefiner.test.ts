import { describe, it, expect, vi } from "vitest";
import { VoiceCommentRefinerService, parseTimestampHeader } from "./voiceCommentRefiner";
import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";
import type { GitHubIssue, GitHubComment } from "../types";

// ── parseTimestampHeader ───────────────────────────────────────────────────────

describe("parseTimestampHeader", () => {
    it("extracts header and content from a formatted comment", () => {
        const { header, content } = parseTimestampHeader("## 10:30\nhello world");
        expect(header).toBe("## 10:30\n");
        expect(content).toBe("hello world");
    });

    it("trims trailing whitespace from content", () => {
        const { header, content } = parseTimestampHeader("## 19:00\nsome text\n");
        expect(header).toBe("## 19:00\n");
        expect(content).toBe("some text");
    });

    it("returns empty header when format does not match", () => {
        const { header, content } = parseTimestampHeader("plain text");
        expect(header).toBe("");
        expect(content).toBe("plain text");
    });

    it("handles kind prefix in content", () => {
        const { header, content } = parseTimestampHeader("## 08:00\n**[idea]** raw voice text\n");
        expect(header).toBe("## 08:00\n");
        expect(content).toBe("**[idea]** raw voice text");
    });
});

// ── VoiceCommentRefinerService ─────────────────────────────────────────────────

const mockIssue: GitHubIssue = { number: 1, html_url: "https://github.com/o/r/issues/1" };
const mockComment: GitHubComment = { id: 55, body: "## 10:00\nraw voice text\n" };

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

function makeTextRefiner(refined = "refined text"): ITextRefinerService {
    return { refine: vi.fn().mockResolvedValue(refined) };
}

describe("VoiceCommentRefinerService.refineComment", () => {
    const message = { owner: "owner", repo: "repo", issueNumber: 1, commentId: 55 };

    it("fetches comment, refines body, and updates comment", async () => {
        const github = makeGitHub();
        const textRefiner = makeTextRefiner("refined text");
        const svc = new VoiceCommentRefinerService(makeAuth(), github, textRefiner);

        await svc.refineComment(message);

        expect(github.getComment).toHaveBeenCalledWith({ owner: "owner", repo: "repo", commentId: 55, token: "tok" });
        expect(textRefiner.refine).toHaveBeenCalledWith("raw voice text");
        const updateCall = (github.updateComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(updateCall.body).toBe("## 10:00\nrefined text\n");
        expect(updateCall.commentId).toBe(55);
    });

    it("preserves timestamp header in updated comment", async () => {
        const github = makeGitHub({
            getComment: vi.fn().mockResolvedValue({ id: 55, body: "## 22:45\noriginal voice\n" }),
        });
        const textRefiner = makeTextRefiner("polished text");
        const svc = new VoiceCommentRefinerService(makeAuth(), github, textRefiner);

        await svc.refineComment(message);

        const updateCall = (github.updateComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(updateCall.body).toBe("## 22:45\npolished text\n");
    });

    it("updates comment even when there is no timestamp header", async () => {
        const github = makeGitHub({
            getComment: vi.fn().mockResolvedValue({ id: 55, body: "plain body" }),
        });
        const textRefiner = makeTextRefiner("refined plain");
        const svc = new VoiceCommentRefinerService(makeAuth(), github, textRefiner);

        await svc.refineComment(message);

        const updateCall = (github.updateComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(updateCall.body).toBe("refined plain\n");
    });

    it("treats empty comment body as empty string for refinement", async () => {
        const github = makeGitHub({
            getComment: vi.fn().mockResolvedValue({ id: 55, body: undefined }),
        });
        const textRefiner = makeTextRefiner("result");
        const svc = new VoiceCommentRefinerService(makeAuth(), github, textRefiner);

        await svc.refineComment(message);

        expect(textRefiner.refine).toHaveBeenCalledWith("");
    });
});
