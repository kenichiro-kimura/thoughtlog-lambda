import type { Payload, CreateEntryOutcome, GetLogOutcome, UpdateLogOutcome } from "../types";

export interface IThoughtLogService {
    createEntry(payload: Payload): Promise<CreateEntryOutcome>;
    getLog(dateKey: string): Promise<GetLogOutcome>;
    updateLog(dateKey: string, newBody: string, source?: string): Promise<UpdateLogOutcome>;
}
