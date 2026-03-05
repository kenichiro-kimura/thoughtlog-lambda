export interface Payload {
    request_id?: string;
    captured_at?: string;
    raw?: string;
    kind?: string;
    labels?: unknown[];
    source?: string;
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
    html_url?: string;
    title?: string;
}

export interface GitHubComment {
    id: number;
    body?: string;
}

export interface GitHubSearchResult {
    items?: GitHubIssue[];
}

// ── ThoughtLog result types ────────────────────────────────────────────────────

export type CreateEntryOutcome =
    | { kind: "created"; date: string; issue_number: number; issue_url: string; comment_id: number }
    | { kind: "idempotent"; statusCode: number; body: { ok: boolean; error?: string; idempotent?: boolean; issue_number?: number; issue_url?: string; comment_id?: number; status?: string } };

export type EnqueueEntryOutcome =
    | { kind: "queued" }
    | { kind: "too_large" };

export type GetLogOutcome =
    | { kind: "found"; body: string }
    | { kind: "not_found"; date: string };

export type UpdateLogOutcome =
    | { kind: "queued"; date: string };

/** Message payload sent to the queue for async voice comment refinement. */
export interface VoiceRefineMessage {
    type: "voice-polish";
    owner: string;
    repo: string;
    issueNumber: number;
    commentId: number;
}

/** Message payload sent to the queue for async final polish of a daily log. */
export interface FinalizeMessage {
    type: "finalize";
    owner: string;
    repo: string;
    dateKey: string;
    labels: string[];
}

/** Message payload sent to the queue for async issue/comment creation. */
export interface CreateEntryMessage {
    type: "create-entry";
    payload: Payload;
}

/** Union of all SQS message types handled by the queue handler. */
export type SqsMessage = VoiceRefineMessage | FinalizeMessage | CreateEntryMessage;

/** Framework-agnostic HTTP response returned by ThoughtLogRouter. */
export interface HttpResponse {
    statusCode: number;
    /** MIME type for the Content-Type header; omitted for application/json responses. */
    contentType?: string;
    body: string;
}
