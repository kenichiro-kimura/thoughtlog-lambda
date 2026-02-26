import type { Payload } from "../types";

export interface IHttpRequest {
    /** Returns the HTTP method (e.g. "GET", "POST"). */
    getMethod(): string;
    /** Returns the raw request path (e.g. "/log/2024-01-15"). */
    getRawPath(): string;
    /**
     * Extracts the date parameter from paths matching /log/yyyy-mm-dd.
     * Returns null when the path does not match.
     */
    getDateParam(): string | null;
    /**
     * Parses and returns the request body as a Payload object.
     * Returns an empty Payload when there is no body.
     * Throws a SyntaxError on malformed JSON.
     */
    getPayload(): Payload;
    /** Returns the decoded (UTF-8) request body string. */
    getRawBody(): string;
}
