import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";
import type { FinalizeMessage } from "../types";

/**
 * Appended to the user-supplied system prompt so that OpenAI always returns
 * a JSON object with `title` and `body` fields.
 * The program side owns this format requirement per the spec.
 */
export const FINALIZE_JSON_FORMAT_APPENDIX =
    "\n\n以下のJSON形式のみで回答してください。JSONオブジェクト以外のテキストは含めないでください:\n" +
    '{"title": "タイトル", "body": "本文（Markdown形式）"}';

interface FinalizeResult {
    title: string;
    body: string;
}

/**
 * Fetches all comments from a GitHub issue, refines them with OpenAI,
 * and updates the issue title and body with the finalised content.
 * The specified date is prepended to the title if not already present.
 */
export class IssueFinalizeService {
    constructor(
        private readonly auth: IAuthService,
        private readonly github: IGitHubService,
        private readonly textRefiner: ITextRefinerService,
    ) {}

    async finalize(message: FinalizeMessage): Promise<void> {
        const { owner, repo, dateKey, labels } = message;
        const token = await this.auth.getInstallationToken();

        const issue = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        if (!issue) {
            throw new Error(`No issue found for date: ${dateKey}`);
        }

        const comments = await this.github.getIssueComments({ owner, repo, issueNumber: issue.number, token });
        const combined = comments.map((c) => c.body ?? "").join("\n\n");

        const refined = await this.textRefiner.refine(combined);

        let result: FinalizeResult;
        try {
            result = JSON.parse(refined) as FinalizeResult;
        } catch (e) {
            throw new Error(
                `Failed to parse OpenAI response as JSON: ${e instanceof Error ? e.message : String(e)}`,
                { cause: e },
            );
        }

        if (!result.title || !result.body) {
            throw new Error("OpenAI response missing required fields: title, body");
        }

        const title = result.title.startsWith(dateKey) ? result.title : `${dateKey} ${result.title}`;

        await this.github.updateIssue({ owner, repo, issueNumber: issue.number, title, body: result.body, token });
    }
}
