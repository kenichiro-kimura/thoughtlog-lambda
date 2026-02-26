export interface HttpRequestOptions {
    method?: string;
    token?: string;
    body?: unknown;
}

/** Minimal HTTP client type used for dependency injection. */
export type HttpClient = (url: string, options?: HttpRequestOptions) => Promise<unknown>;

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
