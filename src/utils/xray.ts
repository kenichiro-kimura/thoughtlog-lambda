import {
    setContextMissingStrategy,
    captureAWSv3Client as xrayCaptureAWSv3Client,
    resolveSegment,
} from "aws-xray-sdk-core";
import type { Subsegment } from "aws-xray-sdk-core";
import type { ITracingService } from "../interfaces/ITracingService";

// Avoid errors when X-Ray context is not available (e.g., local development, tests).
// In Lambda with active tracing enabled, the context is always set up automatically.
setContextMissingStrategy("IGNORE_ERROR");

/**
 * Wraps an AWS SDK v3 client with X-Ray instrumentation.
 * Each SDK command will create a traced subsegment under the current segment.
 */
export function captureAWSv3Client<T extends object>(client: T): T {
    return xrayCaptureAWSv3Client(client as Parameters<typeof xrayCaptureAWSv3Client>[0]) as T;
}

/** AWS X-Ray implementation of ITracingService. */
export class XRayTracingService implements ITracingService {
    async withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
        let subsegment: Subsegment | undefined;
        try {
            const segment = resolveSegment();
            if (segment) {
                subsegment = segment.addNewSubsegment(name);
            }
        } catch {
            // No X-Ray context available — proceed without tracing.
        }
        try {
            const result = await fn();
            subsegment?.close();
            return result;
        } catch (error: unknown) {
            if (subsegment) {
                const err = error instanceof Error ? error : new Error(String(error));
                subsegment.addError(err);
                subsegment.close();
            }
            throw error;
        }
    }
}

