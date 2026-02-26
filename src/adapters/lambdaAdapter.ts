import type { APIGatewayProxyEventV2, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Payload } from "../types";
import type { IHttpRequest } from "../interfaces/IHttpRequest";

/** Named HTTP status code constants. */
export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
} as const;

/** Builds a JSON Lambda result with the given status code and body object. */
export function buildJsonResult(statusCode: number, body: object): APIGatewayProxyResult {
    return { statusCode, body: JSON.stringify(body) };
}

/** Builds a plain-text Lambda result with HTTP 200. */
export function buildTextResult(body: string): APIGatewayProxyResult {
    return {
        statusCode: HTTP_STATUS.OK,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body,
    };
}

/** Adapts an APIGateway event to the framework-agnostic IHttpRequest interface. */
export class LambdaHttpRequest implements IHttpRequest {
    constructor(private readonly event: APIGatewayProxyEventV2 | APIGatewayProxyEvent) {}

    getMethod(): string {
        return (
            "requestContext" in this.event && "http" in this.event.requestContext
                ? (this.event.requestContext as { http: { method: string } }).http.method
                : "httpMethod" in this.event
                    ? this.event.httpMethod
                    : undefined
        ) ?? "POST";
    }

    getRawPath(): string {
        return (
            ("rawPath" in this.event ? this.event.rawPath : undefined) ??
            ("path" in this.event ? this.event.path : undefined) ??
            ""
        );
    }

    getDateParam(): string | null {
        const match = this.getRawPath().match(/\/log\/(\d{4}-\d{2}-\d{2})$/);
        return match ? match[1] : null;
    }

    getPayload(): Payload {
        const { event } = this;
        if (typeof event.body === "string") {
            return JSON.parse(event.body) as Payload;
        }
        if (typeof event.body === "object" && event.body) {
            return event.body as unknown as Payload;
        }
        return {};
    }

    getRawBody(): string {
        const rawBody = typeof this.event.body === "string" ? this.event.body : "";
        return this.event.isBase64Encoded
            ? Buffer.from(rawBody, "base64").toString("utf8")
            : rawBody;
    }
}
