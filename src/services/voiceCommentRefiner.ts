import type { IAuthService } from "../interfaces/IAuthService";
import type { IGitHubService } from "../interfaces/IGitHubService";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";
import type { VoiceRefineMessage } from "../types";

/**
 * Parses a timestamp header from an issue comment body.
 * The expected format is: `## HH:MM\n<content>`.
 * Returns the header (including trailing newline) and the remaining content.
 */
export function parseTimestampHeader(body: string): { header: string; content: string } {
    const match = body.match(/^(## \d{2}:\d{2}\n)([\s\S]*)$/);
    if (match) {
        return { header: match[1], content: match[2].trimEnd() };
    }
    return { header: "", content: body.trimEnd() };
}

/**
 * Fetches a GitHub issue comment, refines its body with OpenAI,
 * and updates the comment with the refined text.
 * The timestamp header (## HH:MM) is preserved during refinement.
 */
export class VoiceCommentRefinerService {
    constructor(
        private readonly auth: IAuthService,
        private readonly github: IGitHubService,
        private readonly textRefiner: ITextRefinerService,
    ) {}

    async refineComment(message: VoiceRefineMessage): Promise<void> {
        const { owner, repo, commentId } = message;
        const token = await this.auth.getInstallationToken();

        const comment = await this.github.getComment({ owner, repo, commentId, token });
        const body = comment.body ?? "";

        const { header, content } = parseTimestampHeader(body);
        const refined = await this.textRefiner.refine(content);
        const newBody = header ? `${header}${refined}\n` : `${refined}\n`;

        await this.github.updateComment({ owner, repo, commentId, body: newBody, token });
    }
}
