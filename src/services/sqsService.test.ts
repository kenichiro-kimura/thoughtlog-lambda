import { describe, it, expect, vi } from "vitest";
import { SqsQueueService } from "./sqsService";
import type { SQSClient } from "@aws-sdk/client-sqs";

function makeSqsClient(): SQSClient {
    return { send: vi.fn().mockResolvedValue({}) } as unknown as SQSClient;
}

describe("SqsQueueService.sendMessage", () => {
    it("sends a message to the queue", async () => {
        const client = makeSqsClient();
        const svc = new SqsQueueService(client, "https://sqs.us-east-1.amazonaws.com/123/my-queue");
        await svc.sendMessage("hello");
        expect(client.send).toHaveBeenCalledOnce();
    });

    it("propagates errors from the SQS client", async () => {
        const client = { send: vi.fn().mockRejectedValue(new Error("SQS error")) } as unknown as SQSClient;
        const svc = new SqsQueueService(client, "https://sqs.us-east-1.amazonaws.com/123/my-queue");
        await expect(svc.sendMessage("hello")).rejects.toThrow("SQS error");
    });
});
