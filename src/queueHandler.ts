import type { SQSEvent } from "aws-lambda";
import { createVoiceCommentRefiner } from "./container";
import type { VoiceRefineMessage } from "./types";

const refiner = createVoiceCommentRefiner({
    githubAppId: process.env.GITHUB_APP_ID,
    githubInstallationId: process.env.GITHUB_INSTALLATION_ID,
    githubPrivateKeySecretArn: process.env.GITHUB_PRIVATE_KEY_SECRET_ARN,
    openAiModel: process.env.OPENAI_MODEL,
    openAiSystemPrompt: process.env.OPENAI_SYSTEM_PROMPT,
});

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        const message = JSON.parse(record.body) as VoiceRefineMessage;
        await refiner.refineComment(message);
    }
};
