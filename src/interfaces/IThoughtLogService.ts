import type { Payload, CreateEntryOutcome, EnqueueEntryOutcome, GetLogOutcome, GetLogBodyOutcome, GetLogCommentsOutcome, UpdateLogOutcome } from "../types";

export interface IThoughtLogService {
    createEntry(payload: Payload): Promise<CreateEntryOutcome>;
    enqueueEntry(payload: Payload): Promise<EnqueueEntryOutcome>;
    getLog(dateKey: string): Promise<GetLogOutcome>;
    getLogBody(dateKey: string): Promise<GetLogBodyOutcome>;
    getLogComments(dateKey: string): Promise<GetLogCommentsOutcome>;
    updateLog(dateKey: string): Promise<UpdateLogOutcome>;
}
