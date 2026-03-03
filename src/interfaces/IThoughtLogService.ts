import type { Payload, CreateEntryOutcome, EnqueueEntryOutcome, GetLogOutcome, UpdateLogOutcome } from "../types";

export interface IThoughtLogService {
    createEntry(payload: Payload): Promise<CreateEntryOutcome>;
    enqueueEntry(payload: Payload): Promise<EnqueueEntryOutcome>;
    getLog(dateKey: string): Promise<GetLogOutcome>;
    updateLog(dateKey: string): Promise<UpdateLogOutcome>;
}
