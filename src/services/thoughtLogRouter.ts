import type { IHttpRequest } from "../interfaces/IHttpRequest";
import type { HttpResponse } from "../types";
import { HTTP_STATUS } from "../utils/httpStatus";
import type { IThoughtLogService } from "../interfaces/IThoughtLogService";

function jsonResponse(statusCode: number, body: object): HttpResponse {
    return { statusCode, body: JSON.stringify(body) };
}

/**
 * Framework-agnostic request dispatcher.
 * Routes incoming requests to the appropriate ThoughtLogService operation
 * and returns a framework-neutral HttpResponse.
 */
export class ThoughtLogRouter {
    constructor(private readonly service: IThoughtLogService) {}

    async handle(request: IHttpRequest): Promise<HttpResponse> {
        const method = request.getMethod();
        const dateParam = request.getDateParam();

        // GET /log/yyyy-mm-dd
        if (method === "GET" && dateParam) {
            try {
                const outcome = await this.service.getLog(dateParam);
                if (outcome.kind === "not_found") {
                    return jsonResponse(HTTP_STATUS.NOT_FOUND, { ok: false, error: "not_found", date: outcome.date });
                }
                return { statusCode: HTTP_STATUS.OK, contentType: "text/plain; charset=utf-8", body: outcome.body };
            } catch (e) {
                return jsonResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // PUT /log/yyyy-mm-dd – enqueue final polish
        if (method === "PUT" && dateParam) {
            try {
                const outcome = await this.service.updateLog(dateParam);
                return jsonResponse(HTTP_STATUS.ACCEPTED, { ok: true, queued: true, date: outcome.date });
            } catch (e) {
                return jsonResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // POST /  – create a new log entry
        if (method !== "POST") {
            return jsonResponse(HTTP_STATUS.METHOD_NOT_ALLOWED, { ok: false, error: "method_not_allowed" });
        }
        let payload;
        try {
            payload = request.getPayload();
        } catch (e) {
            return jsonResponse(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "invalid_json", detail: e instanceof Error ? e.message : String(e) });
        }

        const requestId = (payload.request_id || "").toString().trim();
        if (!requestId) {
            return jsonResponse(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "missing_request_id" });
        }

        try {
            const outcome = await this.service.enqueueEntry(payload);
            if (outcome.kind === "too_large") {
                return jsonResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE, { ok: false, error: "payload_too_large" });
            }
            return jsonResponse(HTTP_STATUS.CREATED, { ok: true, queued: true });
        } catch (e) {
            return jsonResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
    }
}
