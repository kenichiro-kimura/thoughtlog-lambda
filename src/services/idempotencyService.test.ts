import { describe, it, expect, vi } from "vitest";
import { DynamoDBIdempotencyService } from "./idempotencyService";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// ── helpers ───────────────────────────────────────────────────────────────────

type SendFn = (command: unknown) => Promise<unknown>;

function makeDdb(send: SendFn = vi.fn().mockResolvedValue({})): DynamoDBDocumentClient {
    return { send } as unknown as DynamoDBDocumentClient;
}

// ── disabled (no table) ───────────────────────────────────────────────────────

describe("DynamoDBIdempotencyService – disabled", () => {
    it("claim returns enabled=false and claimed=true when tableName is undefined", async () => {
        const svc = new DynamoDBIdempotencyService(makeDdb(), undefined);
        const result = await svc.claim("r1", "hash");
        expect(result).toEqual({ enabled: false, claimed: true });
    });

    it("markDone is a no-op when tableName is undefined", async () => {
        const send = vi.fn();
        const svc = new DynamoDBIdempotencyService(makeDdb(send), undefined);
        await svc.markDone("r1", { issue_number: 1, issue_url: "https://u", comment_id: 2 });
        expect(send).not.toHaveBeenCalled();
    });

    it("markFailed is a no-op when tableName is undefined", async () => {
        const send = vi.fn();
        const svc = new DynamoDBIdempotencyService(makeDdb(send), undefined);
        await svc.markFailed("r1", "oops");
        expect(send).not.toHaveBeenCalled();
    });
});

// ── claim – first write succeeds ──────────────────────────────────────────────

describe("DynamoDBIdempotencyService.claim – first time", () => {
    it("returns enabled=true, claimed=true when PutCommand succeeds", async () => {
        const svc = new DynamoDBIdempotencyService(makeDdb(), "my-table");
        const result = await svc.claim("r1", "hash1");
        expect(result).toEqual({ enabled: true, claimed: true });
    });
});

// ── claim – ConditionalCheckFailedException ───────────────────────────────────

describe("DynamoDBIdempotencyService.claim – duplicate", () => {
    let svc: DynamoDBIdempotencyService;
    let send: ReturnType<typeof vi.fn>;

    function setupWithExistingItem(item: unknown): void {
        send = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }))
            .mockResolvedValueOnce({ Item: item });
        svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
    }

    it("returns 200 idempotent response when item status is done", async () => {
        setupWithExistingItem({
            request_id: "r1",
            status: "done",
            payload_hash: "hash1",
            issue_number: 42,
            issue_url: "https://u",
            comment_id: 5,
        });
        const result = await svc.claim("r1", "hash1");
        expect(result.enabled).toBe(true);
        expect(result.claimed).toBe(false);
        expect(result.statusCode).toBe(200);
        expect(result.body?.idempotent).toBe(true);
        expect(result.body?.issue_number).toBe(42);
    });

    it("returns 202 when item status is processing", async () => {
        setupWithExistingItem({ request_id: "r1", status: "processing", payload_hash: "hash1" });
        const result = await svc.claim("r1", "hash1");
        expect(result.statusCode).toBe(202);
        expect(result.body?.status).toBe("processing");
    });

    it("returns 409 when payload_hash differs (request_id reuse)", async () => {
        setupWithExistingItem({ request_id: "r1", status: "processing", payload_hash: "different-hash" });
        const result = await svc.claim("r1", "hash1");
        expect(result.statusCode).toBe(409);
        expect(result.body?.error).toBe("request_id_reused_with_different_payload");
    });

    it("returns 409 race_retry when item is not found after condition failure", async () => {
        send = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }))
            .mockResolvedValueOnce({ Item: undefined });
        svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
        const result = await svc.claim("r1", "hash1");
        expect(result.statusCode).toBe(409);
        expect(result.body?.error).toBe("idempotency_race_retry");
    });

    it("rethrows non-conditional errors", async () => {
        const networkError = new Error("network failure");
        send = vi.fn().mockRejectedValue(networkError);
        svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
        await expect(svc.claim("r1", "hash1")).rejects.toThrow("network failure");
    });
});

// ── markDone ──────────────────────────────────────────────────────────────────

describe("DynamoDBIdempotencyService.markDone", () => {
    it("calls UpdateCommand with status=done and result fields", async () => {
        const send = vi.fn().mockResolvedValue({});
        const svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
        await svc.markDone("r1", { issue_number: 7, issue_url: "https://u", comment_id: 3 });
        expect(send).toHaveBeenCalledOnce();
        const command = send.mock.calls[0][0];
        expect(command.input.ExpressionAttributeValues[":done"]).toBe("done");
        expect(command.input.ExpressionAttributeValues[":n"]).toBe(7);
    });
});

// ── markFailed ────────────────────────────────────────────────────────────────

describe("DynamoDBIdempotencyService.markFailed", () => {
    it("calls UpdateCommand with status=failed and truncated error message", async () => {
        const send = vi.fn().mockResolvedValue({});
        const svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
        await svc.markFailed("r1", "some error");
        expect(send).toHaveBeenCalledOnce();
        const command = send.mock.calls[0][0];
        expect(command.input.ExpressionAttributeValues[":fail"]).toBe("failed");
    });

    it("swallows errors thrown during markFailed", async () => {
        const send = vi.fn().mockRejectedValue(new Error("ddb error"));
        const svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
        await expect(svc.markFailed("r1", "oops")).resolves.toBeUndefined();
    });

    it("truncates very long error messages to 900 characters", async () => {
        const send = vi.fn().mockResolvedValue({});
        const svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table");
        const longMsg = "x".repeat(2000);
        await svc.markFailed("r1", longMsg);
        const command = send.mock.calls[0][0];
        expect(command.input.ExpressionAttributeValues[":err"].length).toBe(900);
    });
});

// ── custom TTL ────────────────────────────────────────────────────────────────

describe("DynamoDBIdempotencyService – custom TTL", () => {
    it("uses the specified ttlDays when constructing the item", async () => {
        const fixedNow = new Date("2024-06-01T00:00:00Z");
        vi.useFakeTimers();
        vi.setSystemTime(fixedNow);
        try {
            const send = vi.fn().mockResolvedValue({});
            const svc = new DynamoDBIdempotencyService(makeDdb(send as SendFn), "my-table", 30);
            await svc.claim("r1", "hash");
            const command = send.mock.calls[0][0];
            const item = command.input.Item;
            const expectedTtl = Math.floor(fixedNow.getTime() / 1000) + 30 * 24 * 60 * 60;
            expect(item.ttl).toBe(expectedTtl);
        } finally {
            vi.useRealTimers();
        }
    });
});
