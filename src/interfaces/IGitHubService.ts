import type { GitHubIssue, GitHubComment } from "../types";

export interface IGitHubService {
    findDailyIssue(params: { owner: string; repo: string; dateKey: string; labels: string[]; token: string }): Promise<GitHubIssue | null>;
    createDailyIssue(params: { owner: string; repo: string; dateKey: string; labels: string[]; token: string }): Promise<GitHubIssue>;
    addComment(params: { owner: string; repo: string; issueNumber: number; commentBody: string; token: string }): Promise<GitHubComment>;
    updateIssue(params: { owner: string; repo: string; issueNumber: number; body: string; token: string }): Promise<GitHubIssue>;
    closeIssue(params: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubIssue>;
    getIssueComments(params: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubComment[]>;
    getIssue(params: { owner: string; repo: string; issueNumber: number; token: string }): Promise<GitHubIssue>;
}
