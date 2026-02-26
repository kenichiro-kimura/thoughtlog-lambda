import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyEvent } from "aws-lambda";
import { toLambdaResult, LambdaHttpRequest } from "./lambdaAdapter";

// ── toLambdaResult ─────────────────────────────────────────────────────────────

describe("toLambdaResult", () => {
    it("maps statusCode and body", () => {
        const result = toLambdaResult({ statusCode: 200, body: '{"ok":true}' });
        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('{"ok":true}');
    });

    it("omits headers when contentType is not set", () => {
        const result = toLambdaResult({ statusCode: 200, body: "" });
        expect(result.headers).toBeUndefined();
    });

    it("sets Content-Type header when contentType is provided", () => {
        const result = toLambdaResult({ statusCode: 200, contentType: "text/plain; charset=utf-8", body: "hello" });
        expect(result.headers).toEqual({ "Content-Type": "text/plain; charset=utf-8" });
    });
});

// ── LambdaHttpRequest ──────────────────────────────────────────────────────────

function makeV2Event(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
    return {
        version: "2.0",
        routeKey: "$default",
        rawPath: "/",
        rawQueryString: "",
        headers: {},
        requestContext: {
            accountId: "123",
            apiId: "api",
            domainName: "example.com",
            domainPrefix: "api",
            http: { method: "POST", path: "/", protocol: "HTTP/1.1", sourceIp: "1.2.3.4", userAgent: "test" },
            requestId: "id",
            routeKey: "$default",
            stage: "$default",
            time: "01/Jan/2024:00:00:00 +0000",
            timeEpoch: 0,
        },
        isBase64Encoded: false,
        body: undefined,
        ...overrides,
    } as APIGatewayProxyEventV2;
}

function makeV1Event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
        httpMethod: "GET",
        path: "/log/2024-01-15",
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayProxyEvent["requestContext"],
        resource: "",
        isBase64Encoded: false,
        body: null,
        ...overrides,
    } as APIGatewayProxyEvent;
}

describe("LambdaHttpRequest.getMethod", () => {
    it("extracts method from v2 event requestContext.http", () => {
        const req = new LambdaHttpRequest(makeV2Event({ requestContext: { ...makeV2Event().requestContext, http: { method: "GET", path: "/", protocol: "HTTP/1.1", sourceIp: "1.2.3.4", userAgent: "test" } } }));
        expect(req.getMethod()).toBe("GET");
    });

    it("extracts method from v1 event httpMethod", () => {
        const req = new LambdaHttpRequest(makeV1Event({ httpMethod: "PUT" }));
        expect(req.getMethod()).toBe("PUT");
    });

    it("defaults to POST when method cannot be determined", () => {
        // Provide an event without requestContext.http and without httpMethod
        const req = new LambdaHttpRequest({} as APIGatewayProxyEventV2);
        expect(req.getMethod()).toBe("POST");
    });
});

describe("LambdaHttpRequest.getRawPath", () => {
    it("returns rawPath from v2 event", () => {
        const req = new LambdaHttpRequest(makeV2Event({ rawPath: "/log/2024-01-15" }));
        expect(req.getRawPath()).toBe("/log/2024-01-15");
    });

    it("returns path from v1 event", () => {
        const req = new LambdaHttpRequest(makeV1Event({ path: "/log/2024-06-01" }));
        expect(req.getRawPath()).toBe("/log/2024-06-01");
    });

    it("returns empty string when no path is present", () => {
        const req = new LambdaHttpRequest({} as APIGatewayProxyEventV2);
        expect(req.getRawPath()).toBe("");
    });
});

describe("LambdaHttpRequest.getDateParam", () => {
    it("extracts the date from a /log/yyyy-mm-dd path", () => {
        const req = new LambdaHttpRequest(makeV2Event({ rawPath: "/log/2024-01-15" }));
        expect(req.getDateParam()).toBe("2024-01-15");
    });

    it("returns null when the path does not match", () => {
        const req = new LambdaHttpRequest(makeV2Event({ rawPath: "/" }));
        expect(req.getDateParam()).toBeNull();
    });

    it("returns null when the date-like segment has a trailing suffix", () => {
        const req = new LambdaHttpRequest(makeV2Event({ rawPath: "/log/2024-01-15/extra" }));
        expect(req.getDateParam()).toBeNull();
    });
});

describe("LambdaHttpRequest.getRawBody", () => {
    it("returns the raw string body", () => {
        const req = new LambdaHttpRequest(makeV2Event({ body: '{"raw":"hello"}' }));
        expect(req.getRawBody()).toBe('{"raw":"hello"}');
    });

    it("decodes base64-encoded body", () => {
        const encoded = Buffer.from('{"raw":"hi"}').toString("base64");
        const req = new LambdaHttpRequest(makeV2Event({ body: encoded, isBase64Encoded: true }));
        expect(req.getRawBody()).toBe('{"raw":"hi"}');
    });

    it("returns empty string when body is null or undefined", () => {
        const req = new LambdaHttpRequest(makeV2Event({ body: undefined }));
        expect(req.getRawBody()).toBe("");
    });
});

describe("LambdaHttpRequest.getPayload", () => {
    it("parses a JSON string body", () => {
        const req = new LambdaHttpRequest(makeV2Event({ body: '{"request_id":"r1","raw":"hello"}' }));
        expect(req.getPayload()).toEqual({ request_id: "r1", raw: "hello" });
    });

    it("returns an object body as-is when body is already an object", () => {
        const event = makeV1Event({ body: '{"request_id":"r2"}' });
        const req = new LambdaHttpRequest(event);
        expect(req.getPayload()).toEqual({ request_id: "r2" });
    });

    it("returns empty object when body is absent", () => {
        const req = new LambdaHttpRequest(makeV2Event({ body: undefined }));
        expect(req.getPayload()).toEqual({});
    });

    it("throws SyntaxError on malformed JSON string body", () => {
        const req = new LambdaHttpRequest(makeV2Event({ body: "{bad json" }));
        expect(() => req.getPayload()).toThrow(SyntaxError);
    });
});
