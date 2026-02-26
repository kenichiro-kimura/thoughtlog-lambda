import type { IdempotencyResult } from "../types";

export interface IIdempotencyService {
    claim(requestId: string, payloadHash: string): Promise<IdempotencyResult>;
    markDone(requestId: string, result: { issue_number: number; issue_url: string; comment_id: number }): Promise<void>;
    markFailed(requestId: string, errMsg: string): Promise<void>;
}
