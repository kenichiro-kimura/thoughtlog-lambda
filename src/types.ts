export interface Payload {
    request_id?: string;
    captured_at?: string;
    raw?: string;
    kind?: string;
    labels?: unknown[];
}

export interface IdempotencyItem {
    request_id: string;
    status: string;
    payload_hash?: string;
    issue_number?: number;
    issue_url?: string;
    comment_id?: number;
}

export interface IdempotencyResult {
    enabled: boolean;
    claimed: boolean;
    statusCode?: number;
    body?: {
        ok: boolean;
        error?: string;
        idempotent?: boolean;
        issue_number?: number;
        issue_url?: string;
        comment_id?: number;
        status?: string;
    };
}

export interface GitHubIssue {
    number: number;
    html_url: string;
    title?: string;
}

export interface GitHubComment {
    id: number;
    body?: string;
}

export interface GitHubSearchResult {
    items?: GitHubIssue[];
}
