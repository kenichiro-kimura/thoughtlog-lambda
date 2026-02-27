// @ts-check
// Script to polish a GitHub issue using OpenAI API.
// Called by the polish.yml workflow when an issue is labeled 'ready-to-polish'.

const {
    GITHUB_TOKEN,
    OPENAI_API_KEY,
    OPENAI_PROMPT,
    ISSUE_NUMBER,
    REPO_OWNER,
    REPO_NAME,
} = process.env;

const GITHUB_API = 'https://api.github.com';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const POLISH_LABEL = 'ready-to-polish';

/**
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<unknown>}
 */
async function githubFetch(path, options = {}) {
    const res = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...(/** @type {Record<string, string>} */ (options.headers ?? {})),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status} on ${path}: ${text}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} issueNumber
 * @returns {Promise<Array<{ body?: string }>>}
 */
async function getAllComments(owner, repo, issueNumber) {
    /** @type {Array<{ body?: string }>} */
    const comments = [];
    let page = 1;
    while (true) {
        const batch = /** @type {Array<{ body?: string }> | null} */ (
            await githubFetch(
                `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
            )
        );
        if (!batch || batch.length === 0) break;
        comments.push(...batch);
        if (batch.length < 100) break;
        page++;
    }
    return comments;
}

/**
 * @param {string} content
 * @returns {Promise<unknown>}
 */
async function callOpenAI(content) {
    const res = await fetch(OPENAI_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o',
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
    return res.json();
}

async function main() {
    if (!GITHUB_TOKEN) throw new Error('Missing environment variable: GITHUB_TOKEN');
    if (!OPENAI_API_KEY) throw new Error('Missing environment variable: OPENAI_API_KEY');
    if (!OPENAI_PROMPT) throw new Error('Missing environment variable: OPENAI_PROMPT');
    if (!ISSUE_NUMBER) throw new Error('Missing environment variable: ISSUE_NUMBER');
    if (!REPO_OWNER) throw new Error('Missing environment variable: REPO_OWNER');
    if (!REPO_NAME) throw new Error('Missing environment variable: REPO_NAME');

    // Collect all issue comments and join them
    const comments = await getAllComments(REPO_OWNER, REPO_NAME, ISSUE_NUMBER);
    const combined = comments.map(c => c.body ?? '').join('\n\n');

    // Call OpenAI API with the combined message and prompt
    const response = /** @type {{ choices?: Array<{ message?: { content?: string } }> }} */ (
        await callOpenAI(combined)
    );
    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
        throw new Error('No content returned from OpenAI API');
    }

    let parsed;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        throw new Error(`Failed to parse OpenAI response as JSON: ${rawContent}`);
    }

    const { title, body } = /** @type {{ title?: string; body?: string }} */ (parsed);
    if (!title || !body) {
        throw new Error(`OpenAI response is missing "title" or "body": ${rawContent}`);
    }

    // Update the issue title and body
    await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, body }),
    });

    // Remove the 'ready-to-polish' label
    await githubFetch(
        `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}/labels/${encodeURIComponent(POLISH_LABEL)}`,
        { method: 'DELETE' },
    );

    // Close the issue
    await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
    });

    console.log(`Successfully polished and closed issue #${ISSUE_NUMBER}`);
}

main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
