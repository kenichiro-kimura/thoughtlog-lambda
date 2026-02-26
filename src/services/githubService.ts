import type { GitHubIssue, GitHubComment, GitHubSearchResult } from "../types";
import type { HttpClient } from "../utils/http";

export interface IGitHubService {
    findDailyIssue(params: { owner: string; repo: string; dateKey: string; labels: string[]; token: string }): Promise<GitHubIssue | null>;
    createDailyIssue(params: { owner: string; repo: string; dateKey: string; labels: string[]; token: string }): Promise<GitHubIssue>;
    addComment(params: { owner: string; repo: string; issueNumber: number; commentBody: string; token: string }): Promise<GitHubComment>;
    updateIssue(params: { owner: string; repo: string; issueNumber: number; body: string; token: string }): Promise<GitHubIssue>;
    closeIssue(params: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubIssue>;
    getIssueComments(params: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubComment[]>;
    getIssue(params: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubIssue>;
}

/** GitHub REST API implementation. */
export class GitHubApiService implements IGitHubService {
    constructor(private readonly httpClient: HttpClient) {}

    async findDailyIssue({ owner, repo, dateKey, labels, token }: { owner: string; repo: string; dateKey: string; labels: string[]; token: string }): Promise<GitHubIssue | null> {
        const primaryLabel = labels.includes("thoughtlog") ? "thoughtlog" : labels[0];
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
        const result = await this.httpClient(url, { token }) as GitHubSearchResult;

        const items = result?.items ?? [];
        const exact = items.find((it) => (it.title || "").trim() === dateKey);
        return exact ?? null;
    }

    async createDailyIssue({ owner, repo, dateKey, labels, token }: { owner: string; repo: string; dateKey: string; labels: string[]; token: string }): Promise<GitHubIssue> {
        const body = `# ${dateKey}\n\n<!-- summary will be generated later -->\n`;
        return await this.httpClient(`https://api.github.com/repos/${owner}/${repo}/issues`, {
            method: "POST",
            token,
            body: { title: dateKey, body, labels },
        }) as GitHubIssue;
    }

    async addComment({ owner, repo, issueNumber, commentBody, token }: { owner: string; repo: string; issueNumber: number; commentBody: string; token: string }): Promise<GitHubComment> {
        return await this.httpClient(
            `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
            { method: "POST", token, body: { body: commentBody } },
        ) as GitHubComment;
    }

    async updateIssue({ owner, repo, issueNumber, body, token }: { owner: string; repo: string; issueNumber: number; body: string; token: string }): Promise<GitHubIssue> {
        return await this.httpClient(
            `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
            { method: "PATCH", token, body: { body } },
        ) as GitHubIssue;
    }

    async closeIssue({ owner, repo, issueNumber, token }: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubIssue> {
        return await this.httpClient(
            `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
            { method: "PATCH", token, body: { state: "closed" } },
        ) as GitHubIssue;
    }

    async getIssueComments({ owner, repo, issueNumber, token }: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubComment[]> {
        const comments: GitHubComment[] = [];
        let page = 1;
        while (true) {
            const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`;
            const batch = await this.httpClient(url, { token }) as GitHubComment[];
            if (!batch || batch.length === 0) break;
            comments.push(...batch);
            if (batch.length < 100) break;
            page++;
        }
        return comments;
    }

    async getIssue({ owner, repo, issueNumber, token }: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubIssue> {
        return await this.httpClient(
            `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
            { token },
        ) as GitHubIssue;
    }
}
