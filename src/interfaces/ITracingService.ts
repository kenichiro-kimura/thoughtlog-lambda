/**
 * Generic tracing interface for observability.
 * Concrete implementations can target AWS X-Ray, Azure Application Insights, etc.
 */
export interface ITracingService {
    /**
     * Executes an async function inside a named trace subsegment/span.
     * Implementations must silently no-op when no trace context is active.
     */
    withSubsegment<T>(name: string, fn: () => Promise<T>): Promise<T>;
}
