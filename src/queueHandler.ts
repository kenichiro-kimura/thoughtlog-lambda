import type { SQSEvent } from "aws-lambda";
import { createVoiceCommentRefiner, createFinalizeService } from "./container";
import type { SqsMessage } from "./types";

const env = {
    githubAppId: process.env.GITHUB_APP_ID,
    githubInstallationId: process.env.GITHUB_INSTALLATION_ID,
    githubPrivateKeySecretArn: process.env.GITHUB_PRIVATE_KEY_SECRET_ARN,
    openAiModel: process.env.OPENAI_MODEL,
    openAiSystemPrompt: process.env.OPENAI_SYSTEM_PROMPT,
    finalizeOpenAiModel: process.env.FINALIZE_OPENAI_MODEL,
    finalizeOpenAiSystemPrompt: process.env.FINALIZE_OPENAI_SYSTEM_PROMPT,
};

const refiner = createVoiceCommentRefiner(env);
const finalizer = createFinalizeService(env);

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        let message: SqsMessage;
        try {
            message = JSON.parse(record.body) as SqsMessage;
        } catch (error) {
            const bodyPreview = record.body.slice(0, 100);
            const errorMessage = `Failed to parse SQS message body as JSON. messageId=${record.messageId}, bodyPreview=${JSON.stringify(bodyPreview)}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(errorMessage);
            throw new Error(errorMessage, { cause: error });
        }
        if (message.type === "finalize") {
            await finalizer.finalize(message);
        } else {
            await refiner.refineComment(message);
        }
    }
};
