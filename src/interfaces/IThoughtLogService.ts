import type { Payload, CreateEntryOutcome, EnqueueEntryOutcome, GetLogOutcome, GetLogBodyOutcome, GetLogCommentsOutcome, GetLogSummaryOutcome, UpdateLogOutcome } from "../types";

export interface IThoughtLogService {
    createEntry(payload: Payload): Promise<CreateEntryOutcome>;
    enqueueEntry(payload: Payload): Promise<EnqueueEntryOutcome>;
    getLog(dateKey: string): Promise<GetLogOutcome>;
    getLogBody(dateKey: string): Promise<GetLogBodyOutcome>;
    getLogComments(dateKey: string): Promise<GetLogCommentsOutcome>;
    getLogSummary(dateKey: string): Promise<GetLogSummaryOutcome>;
    updateLog(dateKey: string): Promise<UpdateLogOutcome>;
}
