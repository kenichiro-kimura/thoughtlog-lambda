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
        getLog: vi.fn().mockResolvedValue({ kind: "found", body: "## 19:30\nhello\n" }),
        updateLog: vi.fn().mockResolvedValue({
            kind: "updated",
            date: "2024-01-15",
            issue_number: 42,
            issue_url: "https://github.com/owner/repo/issues/42",
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

    it("returns 200 with plain text body when issue is found", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("GET"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        expect(response.contentType).toBe("text/plain; charset=utf-8");
        expect(response.body).toContain("hello");
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
});

// ── PUT /log/:date ─────────────────────────────────────────────────────────────

describe("ThoughtLogRouter PUT /log/:date", () => {
    let router: ThoughtLogRouter;
    let service: IThoughtLogService;

    beforeEach(() => {
        service = makeService();
        router = new ThoughtLogRouter(service);
    });

    it("returns 200 with updated info on success", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
            getRawBody: vi.fn().mockReturnValue('{"raw":"summary text"}'),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({ ok: true, issue_number: 42 });
    });

    it("returns 404 when issue does not exist", async () => {
        service.updateLog = vi.fn().mockResolvedValue({ kind: "not_found", date: "2024-01-15" });
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
            getRawBody: vi.fn().mockReturnValue('{"raw":"text"}'),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(404);
    });

    it("returns 400 on invalid JSON body", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
            getRawBody: vi.fn().mockReturnValue("{bad json"),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "invalid_json" });
    });

    it("returns 400 when raw body is empty", async () => {
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
            getRawBody: vi.fn().mockReturnValue('{"raw":"   "}'),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toMatchObject({ ok: false, error: "missing_body" });
    });

    it("returns 500 when updateLog throws", async () => {
        service.updateLog = vi.fn().mockRejectedValue(new Error("db error"));
        const request = makeRequest({
            getMethod: vi.fn().mockReturnValue("PUT"),
            getDateParam: vi.fn().mockReturnValue("2024-01-15"),
            getRawBody: vi.fn().mockReturnValue('{"raw":"text"}'),
        });
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
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

    it("returns 201 with created entry info", async () => {
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toMatchObject({ ok: true, issue_number: 42, comment_id: 99 });
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

    it("returns idempotent statusCode and body for duplicate request", async () => {
        service.createEntry = vi.fn().mockResolvedValue({
            kind: "idempotent",
            statusCode: 200,
            body: { ok: true, idempotent: true, issue_number: 42 },
        });
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({ ok: true, idempotent: true });
    });

    it("returns 500 when createEntry throws", async () => {
        service.createEntry = vi.fn().mockRejectedValue(new Error("gh error"));
        const request = makeRequest();
        const response = await router.handle(request);
        expect(response.statusCode).toBe(500);
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
