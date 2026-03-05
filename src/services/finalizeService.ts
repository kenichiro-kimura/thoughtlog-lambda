import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";
import type { FinalizeMessage } from "../types";
import { nowJstDateTime } from "../utils/date";
import { parseLabels } from "../utils/format";

export interface FinalizeConfig {
    owner: string;
    repo: string;
    defaultLabels: string;
}

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
        private readonly config: FinalizeConfig,
    ) {}

    async finalize(message: FinalizeMessage): Promise<void> {
        const { dateKey } = message;
        const { owner, repo } = this.config;
        const labels = parseLabels(this.config.defaultLabels, []);
        const token = await this.auth.getInstallationToken();

        const issue = await this.github.findDailyIssue({ owner, repo, dateKey, labels, token });
        const labelsDescription = Array.isArray(labels) && labels.length > 0 ? labels.join(",") : "(none)";
        if (!issue) {
            throw new Error(
                `Issue not found for owner=${owner} repo=${repo} dateKey=${dateKey} labels=${labelsDescription}`,
            );
        }
        const issueNumber = issue.number;

        const comments = await this.github.getIssueComments({ owner, repo, issueNumber, token });
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

        if (typeof result.title !== "string" || typeof result.body !== "string" || !result.title.trim() || !result.body.trim()) {
            throw new Error("OpenAI response missing required fields: title, body");
        }

        const title = result.title.startsWith(dateKey) ? result.title : `${dateKey} ${result.title}`;

        await this.github.updateIssue({ owner, repo, issueNumber, title, body: result.body, token });
        await this.github.addComment({ owner, repo, issueNumber, commentBody: `\`\`\`\`\n# ${title}\n\n${result.body}\n\`\`\`\`\n`, token });
        await this.github.addComment({ owner, repo, issueNumber, commentBody: `finalizeしました(${nowJstDateTime()})`, token });
        await this.github.closeIssue({ owner, repo, issueNumber, token });
    }
}
