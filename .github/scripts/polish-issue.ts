// Script to polish a GitHub issue using OpenAI API.
// Called by the polish.yml workflow when an issue is labeled 'ready-to-polish'.

const {
    GITHUB_TOKEN,
    OPENAI_API_KEY,
    OPENAI_PROMPT,
    OPENAI_MODEL,
    ISSUE_NUMBER,
    REPO_OWNER,
    REPO_NAME,
} = process.env;

const GITHUB_API = 'https://api.github.com';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const POLISH_LABEL = 'ready-to-polish';

/** Timeout for GitHub API requests in milliseconds. */
const GITHUB_TIMEOUT_MS = 30_000;
/** Timeout for OpenAI API requests in milliseconds. */
const OPENAI_TIMEOUT_MS = 60_000;

interface GitHubComment {
    body?: string;
}

interface OpenAIResponse {
    choices?: Array<{ message?: { content?: string } }>;
}

interface PolishResult {
    title?: string;
    body?: string;
}

async function githubFetch(path: string, options: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...((options.headers ?? {}) as Record<string, string>),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status} on ${path}: ${text}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function getAllComments(owner: string, repo: string, issueNumber: string): Promise<GitHubComment[]> {
    const comments: GitHubComment[] = [];
    let page = 1;
    while (true) {
        const batch = (await githubFetch(
            `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
        )) as GitHubComment[] | null;
        if (!batch || batch.length === 0) break;
        comments.push(...batch);
        if (batch.length < 100) break;
        page++;
    }
    return comments;
}

async function callOpenAI(content: string): Promise<OpenAIResponse> {
    const model = OPENAI_MODEL && OPENAI_MODEL.trim()
        ? OPENAI_MODEL.trim()
        : 'gpt-4o';
    const res = await fetch(OPENAI_API, {
        method: 'POST',
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: OPENAI_PROMPT },
                { role: 'user', content },
            ],
            response_format: { type: 'json_object' },
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<OpenAIResponse>;
}

async function main(): Promise<void> {
    if (!GITHUB_TOKEN) throw new Error('Missing environment variable: GITHUB_TOKEN');
    if (!OPENAI_API_KEY) throw new Error('Missing environment variable: OPENAI_API_KEY');
    if (!OPENAI_PROMPT) throw new Error('Missing environment variable: OPENAI_PROMPT');
    if (!ISSUE_NUMBER) throw new Error('Missing environment variable: ISSUE_NUMBER');
    if (!REPO_OWNER) throw new Error('Missing environment variable: REPO_OWNER');
    if (!REPO_NAME) throw new Error('Missing environment variable: REPO_NAME');

    // Collect all issue comments, normalize, and join them
    const comments = await getAllComments(REPO_OWNER, REPO_NAME, ISSUE_NUMBER);
    const nonEmptyComments = comments
        .map(c => (c.body ?? '').trim())
        .filter(Boolean);
    const combined = nonEmptyComments.join('\n\n');

    if (!combined) {
        console.log(
            `Issue #${ISSUE_NUMBER} has no non-empty comments; skipping OpenAI call.`,
        );

        // Close the issue even when there are no comments.
        await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}`, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'closed' }),
        });

        // Best-effort: remove the label.
        try {
            await githubFetch(
                `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}/labels/${encodeURIComponent(POLISH_LABEL)}`,
                { method: 'DELETE' },
            );
        } catch (err) {
            console.error(
                `Failed to remove label "${POLISH_LABEL}" from issue #${ISSUE_NUMBER} when skipping: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }

        console.log(`Closed issue #${ISSUE_NUMBER} without polishing (no comments).`);
        return;
    }

    // Call OpenAI API with the combined message and prompt
    const response = await callOpenAI(combined);
    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
        throw new Error('No content returned from OpenAI API');
    }

    let parsed: PolishResult;
    try {
        parsed = JSON.parse(rawContent) as PolishResult;
    } catch {
        throw new Error(`Failed to parse OpenAI response as JSON: ${rawContent}`);
    }

    const { title, body } = parsed;
    if (!title || !body) {
        throw new Error(`OpenAI response is missing "title" or "body": ${rawContent}`);
    }

    // Update the issue title and body (fail-fast on error)
    await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, body }),
    });

    // Close the issue (fail-fast on error)
    await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
    });

    // Remove the 'ready-to-polish' label (best-effort; do not block closing the issue)
    try {
        await githubFetch(
            `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}/labels/${encodeURIComponent(POLISH_LABEL)}`,
            { method: 'DELETE' },
        );
    } catch (err) {
        console.error(
            `Failed to remove label "${POLISH_LABEL}" from issue #${ISSUE_NUMBER}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }

    console.log(`Successfully polished and closed issue #${ISSUE_NUMBER}`);
}

main().catch(err => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
});
