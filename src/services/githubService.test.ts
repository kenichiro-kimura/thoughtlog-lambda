import { describe, it, expect, vi } from "vitest";
import { GitHubApiService } from "./githubService";
import type { HttpClient } from "../utils/http";
import type { GitHubIssue, GitHubComment } from "../types";

const owner = "owner";
const repo = "repo";
const token = "tok";

function makeHttp(returnValue: unknown = {}): HttpClient {
    return vi.fn().mockResolvedValue(returnValue);
}

// ── findDailyIssue ─────────────────────────────────────────────────────────────

describe("GitHubApiService.findDailyIssue", () => {
    it("returns the issue whose title exactly matches the dateKey", async () => {
        const issue: GitHubIssue = { number: 1, html_url: "https://github.com/o/r/issues/1", title: "2024-01-15" };
        const http = makeHttp({ items: [issue] });
        const svc = new GitHubApiService(http);
        const result = await svc.findDailyIssue({ owner, repo, dateKey: "2024-01-15", labels: ["thoughtlog"], token });
        expect(result).toEqual(issue);
    });

    it("returns null when no item matches the dateKey exactly", async () => {
        const http = makeHttp({ items: [{ number: 1, title: "2024-01-14" }] });
        const svc = new GitHubApiService(http);
        const result = await svc.findDailyIssue({ owner, repo, dateKey: "2024-01-15", labels: ["thoughtlog"], token });
        expect(result).toBeNull();
    });

    it("returns null when search result has no items", async () => {
        const http = makeHttp({});
        const svc = new GitHubApiService(http);
        const result = await svc.findDailyIssue({ owner, repo, dateKey: "2024-01-15", labels: [], token });
        expect(result).toBeNull();
    });
});

// ── createDailyIssue ───────────────────────────────────────────────────────────

describe("GitHubApiService.createDailyIssue", () => {
    it("posts to the issues endpoint and returns the created issue", async () => {
        const issue: GitHubIssue = { number: 7, html_url: "https://github.com/o/r/issues/7", title: "2024-06-01" };
        const http = makeHttp(issue);
        const svc = new GitHubApiService(http);
        const result = await svc.createDailyIssue({ owner, repo, dateKey: "2024-06-01", labels: ["thoughtlog"], token });
        expect(result).toEqual(issue);
        const [url, opts] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain(`/repos/${owner}/${repo}/issues`);
        expect((opts as { body: { title: string } }).body.title).toBe("2024-06-01");
    });
});

// ── addComment ─────────────────────────────────────────────────────────────────

describe("GitHubApiService.addComment", () => {
    it("posts a comment and returns it", async () => {
        const comment: GitHubComment = { id: 55, body: "## 10:00\nhello\n" };
        const http = makeHttp(comment);
        const svc = new GitHubApiService(http);
        const result = await svc.addComment({ owner, repo, issueNumber: 1, commentBody: "## 10:00\nhello\n", token });
        expect(result).toEqual(comment);
        const [url] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain("/issues/1/comments");
    });
});

// ── updateIssue ────────────────────────────────────────────────────────────────

describe("GitHubApiService.updateIssue", () => {
    it("patches the issue body and returns the updated issue", async () => {
        const issue: GitHubIssue = { number: 3 };
        const http = makeHttp(issue);
        const svc = new GitHubApiService(http);
        const result = await svc.updateIssue({ owner, repo, issueNumber: 3, body: "new summary", token });
        expect(result).toEqual(issue);
        const [, opts] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect((opts as { method: string }).method).toBe("PATCH");
    });
});

// ── closeIssue ─────────────────────────────────────────────────────────────────

describe("GitHubApiService.closeIssue", () => {
    it("patches state to closed and returns the closed issue", async () => {
        const issue: GitHubIssue = { number: 3 };
        const http = makeHttp(issue);
        const svc = new GitHubApiService(http);
        const result = await svc.closeIssue({ owner, repo, issueNumber: 3, token });
        expect(result).toEqual(issue);
        const [, opts] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect((opts as { body: { state: string } }).body.state).toBe("closed");
    });
});

// ── getIssueComments ───────────────────────────────────────────────────────────

describe("GitHubApiService.getIssueComments", () => {
    it("returns all comments from a single page", async () => {
        const comments: GitHubComment[] = [{ id: 1, body: "a" }, { id: 2, body: "b" }];
        const http = vi.fn()
            .mockResolvedValueOnce(comments)
            .mockResolvedValueOnce([]);
        const svc = new GitHubApiService(http as HttpClient);
        const result = await svc.getIssueComments({ owner, repo, issueNumber: 5, token });
        expect(result).toEqual(comments);
    });

    it("paginates and collects all pages", async () => {
        const page1: GitHubComment[] = Array.from({ length: 100 }, (_, i) => ({ id: i, body: `c${i}` }));
        const page2: GitHubComment[] = [{ id: 100, body: "last" }];
        const http = vi.fn()
            .mockResolvedValueOnce(page1)
            .mockResolvedValueOnce(page2)
            .mockResolvedValueOnce([]);
        const svc = new GitHubApiService(http as HttpClient);
        const result = await svc.getIssueComments({ owner, repo, issueNumber: 5, token });
        expect(result).toHaveLength(101);
    });

    it("returns empty array when there are no comments", async () => {
        const http = makeHttp([]);
        const svc = new GitHubApiService(http);
        const result = await svc.getIssueComments({ owner, repo, issueNumber: 5, token });
        expect(result).toEqual([]);
    });
});

// ── getIssue ───────────────────────────────────────────────────────────────────

describe("GitHubApiService.getIssue", () => {
    it("fetches and returns the issue", async () => {
        const issue: GitHubIssue = { number: 8, html_url: "https://github.com/o/r/issues/8" };
        const http = makeHttp(issue);
        const svc = new GitHubApiService(http);
        const result = await svc.getIssue({ owner, repo, issueNumber: 8, token });
        expect(result).toEqual(issue);
        const [url] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain("/issues/8");
    });
});

// ── getComment ─────────────────────────────────────────────────────────────────

describe("GitHubApiService.getComment", () => {
    it("fetches and returns a single comment", async () => {
        const comment: GitHubComment = { id: 55, body: "## 10:00\nhello\n" };
        const http = makeHttp(comment);
        const svc = new GitHubApiService(http);
        const result = await svc.getComment({ owner, repo, commentId: 55, token });
        expect(result).toEqual(comment);
        const [url] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain("/issues/comments/55");
    });
});

// ── updateComment ──────────────────────────────────────────────────────────────

describe("GitHubApiService.updateComment", () => {
    it("patches the comment body and returns the updated comment", async () => {
        const comment: GitHubComment = { id: 55, body: "## 10:00\nrefined\n" };
        const http = makeHttp(comment);
        const svc = new GitHubApiService(http);
        const result = await svc.updateComment({ owner, repo, commentId: 55, body: "## 10:00\nrefined\n", token });
        expect(result).toEqual(comment);
        const [url, opts] = (http as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain("/issues/comments/55");
        expect((opts as { method: string }).method).toBe("PATCH");
    });
});
