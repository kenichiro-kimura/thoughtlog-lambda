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

        // PUT /log/yyyy-mm-dd
        if (method === "PUT" && dateParam) {
            const decodedBody = request.getRawBody();
            let putPayload: { raw?: string };
            try {
                putPayload = decodedBody ? JSON.parse(decodedBody) as { raw?: string } : {};
            } catch (e) {
                return jsonResponse(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "invalid_json", detail: e instanceof Error ? e.message : String(e) });
            }
            const newBody = (putPayload.raw ?? "").toString().trim();
            if (!newBody) {
                return jsonResponse(HTTP_STATUS.BAD_REQUEST, { ok: false, error: "missing_body" });
            }
            try {
                const outcome = await this.service.updateLog(dateParam, newBody);
                if (outcome.kind === "not_found") {
                    return jsonResponse(HTTP_STATUS.NOT_FOUND, { ok: false, error: "not_found", date: outcome.date });
                }
                return jsonResponse(HTTP_STATUS.OK, { ok: true, date: outcome.date, issue_number: outcome.issue_number, issue_url: outcome.issue_url });
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
            const outcome = await this.service.createEntry(payload);
            if (outcome.kind === "idempotent") {
                return jsonResponse(outcome.statusCode, outcome.body);
            }
            return jsonResponse(HTTP_STATUS.CREATED, {
                ok: true,
                date: outcome.date,
                issue_number: outcome.issue_number,
                issue_url: outcome.issue_url,
                comment_id: outcome.comment_id,
            });
        } catch (e) {
            return jsonResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
    }
}
