import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { IQueueService } from "../interfaces/IQueueService";

export type { IQueueService };

/** Amazon SQS implementation of IQueueService. */
export class SqsQueueService implements IQueueService {
    constructor(
        private readonly client: SQSClient,
        private readonly queueUrl: string,
    ) {}

    async sendMessage(message: string): Promise<void> {
        await this.client.send(new SendMessageCommand({
            QueueUrl: this.queueUrl,
            MessageBody: message,
        }));
    }
}
