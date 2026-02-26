import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { IdempotencyItem, IdempotencyResult } from "../types";
import { nowEpoch } from "../utils/date";
import type { IIdempotencyService } from "../interfaces/IIdempotencyService";

export type { IIdempotencyService };

/** DynamoDB-backed idempotency store. When tableName is undefined, idempotency is disabled. */
export class DynamoDBIdempotencyService implements IIdempotencyService {
    constructor(
        private readonly ddb: DynamoDBDocumentClient,
        private readonly tableName: string | undefined,
        private readonly ttlDays: number = 14,
    ) {}

    async claim(requestId: string, payloadHash: string): Promise<IdempotencyResult> {
        if (!this.tableName) return { enabled: false, claimed: true };

        const ttl = nowEpoch() + this.ttlDays * 24 * 60 * 60;

        try {
            await this.ddb.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    request_id: requestId,
                    status: "processing",
                    payload_hash: payloadHash,
                    created_at: nowEpoch(),
                    ttl,
                },
                ConditionExpression: "attribute_not_exists(request_id)",
            }));
            return { enabled: true, claimed: true };
        } catch (e) {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;

            const existing = await this.ddb.send(new GetCommand({
                TableName: this.tableName,
                Key: { request_id: requestId },
            }));

            const item = existing.Item as IdempotencyItem | undefined;
            if (!item) return { enabled: true, claimed: false, statusCode: 409, body: { ok: false, error: "idempotency_race_retry" } };

            if (item.payload_hash && item.payload_hash !== payloadHash) {
                return { enabled: true, claimed: false, statusCode: 409, body: { ok: false, error: "request_id_reused_with_different_payload" } };
            }

            if (item.status === "done") {
                return {
                    enabled: true,
                    claimed: false,
                    statusCode: 200,
                    body: {
                        ok: true,
                        idempotent: true,
                        issue_number: item.issue_number,
                        issue_url: item.issue_url,
                        comment_id: item.comment_id,
                    },
                };
            }

            return { enabled: true, claimed: false, statusCode: 202, body: { ok: true, idempotent: true, status: item.status || "processing" } };
        }
    }

    async markDone(requestId: string, { issue_number, issue_url, comment_id }: { issue_number: number; issue_url: string; comment_id: number }): Promise<void> {
        if (!this.tableName) return;

        await this.ddb.send(new UpdateCommand({
            TableName: this.tableName,
            Key: { request_id: requestId },
            UpdateExpression: "SET #s = :done, issue_number = :n, issue_url = :u, comment_id = :c",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":done": "done",
                ":n": issue_number,
                ":u": issue_url,
                ":c": comment_id,
            },
        }));
    }

    async markFailed(requestId: string, errMsg: string): Promise<void> {
        if (!this.tableName) return;

        try {
            await this.ddb.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { request_id: requestId },
                UpdateExpression: "SET #s = :fail, error = :err",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                    ":fail": "failed",
                    ":err": String(errMsg).slice(0, 900),
                },
            }));
        } catch {
            // markFailed is best-effort; swallowing errors here prevents masking the original failure
        }
    }
}
