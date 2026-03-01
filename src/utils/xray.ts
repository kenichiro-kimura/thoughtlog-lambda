import {
    setContextMissingStrategy,
    captureAWSv3Client as xrayCaptureAWSv3Client,
    resolveSegment,
} from "aws-xray-sdk-core";
import type { Subsegment } from "aws-xray-sdk-core";

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

/**
 * Executes an async function inside an X-Ray subsegment.
 * Safely no-ops when no X-Ray segment is active (e.g., local development, tests).
 */
export async function withSubsegment<T>(name: string, fn: () => Promise<T>): Promise<T> {
    let subseg: Subsegment | undefined;
    try {
        const segment = resolveSegment();
        if (segment) {
            subseg = segment.addNewSubsegment(name);
        }
    } catch {
        // No X-Ray context available — proceed without tracing.
    }
    try {
        const result = await fn();
        subseg?.close();
        return result;
    } catch (error) {
        if (subseg) {
            subseg.addError(error as Error);
            subseg.close();
        }
        throw error;
    }
}
