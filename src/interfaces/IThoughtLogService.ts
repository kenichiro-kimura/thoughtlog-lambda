import type { Payload } from "../types";
import type { CreateEntryOutcome, GetLogOutcome, UpdateLogOutcome } from "../services/thoughtLogService";

export type { CreateEntryOutcome, GetLogOutcome, UpdateLogOutcome };

export interface IThoughtLogService {
    createEntry(payload: Payload): Promise<CreateEntryOutcome>;
    getLog(dateKey: string): Promise<GetLogOutcome>;
    updateLog(dateKey: string, newBody: string): Promise<UpdateLogOutcome>;
}
