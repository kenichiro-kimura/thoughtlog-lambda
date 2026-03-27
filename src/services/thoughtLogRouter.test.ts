import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThoughtLogRouter } from "./thoughtLogRouter";
import type { IThoughtLogService } from "../interfaces/IThoughtLogService";
import type { IHttpRequest } from "../interfaces/IHttpRequest";
import type { Payload } from "../types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<IHttpRequest> = {}): IHttpRequest {
    return {
        getMethod: vi.fn().mockReturnValue("POST"),
        getRawPath: vi.fn().mockReturnValue("/"),
        getDateParam: vi.fn().mockReturnValue(null),
        getSubResource: vi.fn().mockReturnValue(null),
        getPayload: vi.fn().mockReturnValue({ request_id: "req-1", raw: "hello" } as Payload),
        getRawBody: vi.fn().mockReturnValue(""),
        ...overrides,
    };
}

function makeService(overrides: Partial<IThoughtLogService> = {}): IThoughtLogService {
    return {
        createEntry: vi.fn().mockResolvedValue({
            kind: "created",
            date: "2024-01-15",
            issue_number: 42,
            issue_url: "https://github.com/owner/repo/issues/42",
            comment_id: 99,
        }),
        enqueueEntry: vi.fn().mockResolvedValue({ kind: "queued" }),
        getLog: vi.fn().mockResolvedValue({
            kind: "found",
            id: "issue-id-42",
            date: "2024-01-15",
            title: "2024-01-15",
            links: { body: "/log/2024-01-15/body", comments: "/log/2024-01-15/comments" },
        }),
        getLogBody: vi.fn().mockResolvedValue({ kind: "found", body: "# 2024-01-15\n\nSummary text." }),
        getLogComments: vi.fn().mockResolvedValue({ kind: "found", comments: ["## 19:30\nhello\n", "## 20:00\nworld\n"] }),
        getLogSummary: vi.fn().mockResolvedValue({ kind: "found", summary: "This is the summary." }),
        updateLog: vi.fn().mockResolvedValue({
            kind: "queued",
            date: "2024-01-15",
        }),
        ...overrides,
    } as IThoughtLogService;
}

// ── GET /log/:date ─────────────────────────────────────────────────────────────

describe("ThoughtLogRouter GET /log/:date", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 200 with JSON summary when issue is found", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        expect(response.contentType).toBeUndefined();
        const body = JSON.parse(response.body);
        expect(body).toMatchObject({
            id: "issue-id-42",
            date: "2024-01-15",
            title: "2024-01-15",
            links: { body: "/log/2024-01-15/body", comments: "/log/2024-01-15/comments" },
        });
    });

    it("returns 404 when the daily issue does not exist", async () => {
        service.getLog = vi.fn().mockResolvedValue({ kind: "not_found", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "not_found" });
    });

    it("returns 500 when getLog throws", async () => {
        service.getLog = vi.fn().mockRejectedValue(new Error("network error"));
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "network error" });
    });

    it("returns 500 with stringified error when getLog throws a non-Error value", async () => {
        service.getLog = vi.fn().mockRejectedValue("plain string error");
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "plain string error" });
    });
});

// ── GET /log/:date/body ────────────────────────────────────────────────────────

describe("ThoughtLogRouter GET /log/:date/body", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 200 with body when issue is found", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "body" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        const parsed = JSON.parse(response.body);
        expect(parsed).toMatchObject({ body: "# 2024-01-15\n\nSummary text." });
    });

    it("returns 404 when the daily issue does not exist", async () => {
        service.getLogBody = vi.fn().mockResolvedValue({ kind: "not_found", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "body" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "not_found" });
    });

    it("returns 500 when getLogBody throws", async () => {
        service.getLogBody = vi.fn().mockRejectedValue(new Error("network error"));
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "body" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "network error" });
    });
});

// ── GET /log/:date/comments ────────────────────────────────────────────────────

describe("ThoughtLogRouter GET /log/:date/comments", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 200 with comments array when issue is found", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "comments" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        const parsed = JSON.parse(response.body);
        expect(parsed.comments).toEqual(["## 19:30\nhello\n", "## 20:00\nworld\n"]);
    });

    it("returns 404 when the daily issue does not exist", async () => {
        service.getLogComments = vi.fn().mockResolvedValue({ kind: "not_found", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "comments" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "not_found" });
    });

    it("returns 500 when getLogComments throws", async () => {
        service.getLogComments = vi.fn().mockRejectedValue(new Error("db error"));
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "comments" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "db error" });
    });
});

// ── GET /log/:date/summary ─────────────────────────────────────────────────────

describe("ThoughtLogRouter GET /log/:date/summary", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 200 with summary when issue is found", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "summary" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        const parsed = JSON.parse(response.body);
        expect(parsed).toMatchObject({ summary: "This is the summary." });
    });

    it("returns 404 when the daily issue does not exist", async () => {
        service.getLogSummary = vi.fn().mockResolvedValue({ kind: "not_found", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "summary" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "not_found" });
    });

    it("returns 500 when getLogSummary throws", async () => {
        service.getLogSummary = vi.fn().mockRejectedValue(new Error("network error"));
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getSubResource: vi.fn().mockReturnValue({ date: "2024-01-15", resource: "summary" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "network error" });
    });
});

// ── PUT /log/:date ─────────────────────────────────────────────────────────────

describe("ThoughtLogRouter PUT /log/:date", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 202 with queued info on success", async () => {
        service.updateLog = vi.fn().mockResolvedValue({ kind: "queued", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toMatchObject({ ok: true, queued: true, date: "2024-01-15" });
    });

    it("returns 500 when updateLog throws", async () => {
        service.updateLog = vi.fn().mockRejectedValue(new Error("db error"));
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
    });

    it("returns 500 with stringified error when updateLog throws a non-Error value", async () => {
        service.updateLog = vi.fn().mockRejectedValue("plain string error");
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "plain string error" });
    });

    it("calls updateLog with only the dateKey (no body required)", async () => {
        service.updateLog = vi.fn().mockResolvedValue({ kind: "queued", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        await router.handle(request);
        expect(service.updateLog).toHaveBeenCalledWith("2024-01-15");
    });
});

// ── POST / (create entry) ─────────────────────────────────────────────────────

describe("ThoughtLogRouter POST /", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 201 with queued info", async () => {
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toMatchObject({ ok: true, queued: true });
    });

    it("returns 400 when request_id is missing", async () => {
        const request = makeRequest({
            getPayload: vi.fn().mockReturnValue({ raw: "hello" }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "missing_request_id" });
    });

    it("returns 400 when payload is invalid JSON", async () => {
        const request = makeRequest({
            getPayload: vi.fn().mockImplementation(() => { throw new SyntaxError("Unexpected token"); }),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "invalid_json" });
    });

    it("returns 413 when payload is too large", async () => {
        service.enqueueEntry = vi.fn().mockResolvedValue({ kind: "too_large" });
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(413);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "payload_too_large" });
    });

    it("returns 500 when enqueueEntry throws", async () => {
        service.enqueueEntry = vi.fn().mockRejectedValue(new Error("queue error"));
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
    });

    it("returns 500 with stringified error when enqueueEntry throws a non-Error value", async () => {
        service.enqueueEntry = vi.fn().mockRejectedValue("plain string error");
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "plain string error" });
    });

    it("calls enqueueEntry with the parsed payload", async () => {
        const request = makeRequest();
        await router.handle(request);
        expect(service.enqueueEntry).toHaveBeenCalledWith({ request_id: "req-1", raw: "hello" });
    });
});

// ── method not allowed ────────────────────────────────────────────────────────

describe("ThoughtLogRouter method_not_allowed", () => {
    it("returns 405 for DELETE method", async () => {
        const service = makeService();
        const router = new ThoughtLogRouter(service);
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("DELETE"),
            getDateParam: vi.fn().mockReturnValue(null),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(405);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "method_not_allowed" });
    });
});

