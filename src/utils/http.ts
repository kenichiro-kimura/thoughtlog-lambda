export interface HttpRequestOptions {
    method?: string;
    token?: string;
    body?: unknown;
}

/** Minimal HTTP client type used for dependency injection. */
export type HttpClient = (url: string, options?: HttpRequestOptions) => Promise<unknown>;

const OPENAI_TIMEOUT_MS = 10_000;

/** OpenAI-aware HTTP client implementation with timeout and error body support. */
export async function openAIRequest(
    url: string,
    { method = "GET", token, body }: HttpRequestOptions = {},
): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, OPENAI_TIMEOUT_MS);

    let res: Response;
    try {
        res = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`OpenAI API request timed out after ${OPENAI_TIMEOUT_MS}ms`, { cause: error });
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    if (!res.ok) {
        let errorBodySnippet = "";
        try {
            const rawBody = await res.text();
            const MAX_ERROR_BODY_LENGTH = 1000;
            if (rawBody) {
                errorBodySnippet = rawBody.length > MAX_ERROR_BODY_LENGTH
                    ? `${rawBody.slice(0, MAX_ERROR_BODY_LENGTH)}...[truncated]`
                    : rawBody;
            }
        } catch {
            // レスポンス本文が読めない場合は本文なしでエラーを返す
        }
        const messageBase = `OpenAI API error: ${res.status} ${res.statusText}`;
        if (errorBodySnippet) {
            throw new Error(messageBase, { cause: new Error(errorBodySnippet) });
        }
        throw new Error(messageBase);
    }

    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return { raw: text };
    }
}

/** Default GitHub-aware HTTP client implementation. */
export async function githubRequest(
    url: string,
    { method = "GET", token, body }: HttpRequestOptions = {},
): Promise<unknown> {
    const res = await fetch(url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/vnd.github+json",
            "User-Agent": "thoughtlog-lambda",
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }

    if (!res.ok) {
        throw new Error(`GitHub API ${res.status}: ${JSON.stringify(json)}`);
    }
    return json;
}
