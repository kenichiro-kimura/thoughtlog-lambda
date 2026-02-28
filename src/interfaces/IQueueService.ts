export interface IQueueService {
    sendMessage(message: string): Promise<void>;
}
