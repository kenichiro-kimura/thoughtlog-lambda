import type { SQSEvent } from "aws-lambda";
import { createVoiceCommentRefiner, createFinalizeService, createThoughtLogService } from "./container";
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

const githubOwner = process.env.GITHUB_OWNER;
if (!githubOwner) {
    throw new Error("Environment variable GITHUB_OWNER is required but was not set.");
}

const githubRepo = process.env.GITHUB_REPO;
if (!githubRepo) {
    throw new Error("Environment variable GITHUB_REPO is required but was not set.");
}

const refiner = createVoiceCommentRefiner(env);
const finalizer = createFinalizeService(env);
const thoughtLog = createThoughtLogService({
    owner: githubOwner,
    repo: githubRepo,
    defaultLabels: process.env.DEFAULT_LABELS || "thoughtlog",
    ...env,
    idempotencyTable: process.env.IDEMPOTENCY_TABLE,
    idempotencyTtlDays: undefined,
    voiceQueueUrl: process.env.VOICE_QUEUE_URL,
});

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
        } else if (message.type === "voice-polish") {
            await refiner.refineComment(message);
        } else if (message.type === "create-entry") {
            const result = await thoughtLog.createEntry(message.payload);

            if (result?.kind === "idempotent" && result?.body?.status === "failed") {
                const errorMessage = `Idempotent create-entry is in failed state. messageId=${record.messageId}`;
                console.error(errorMessage, { result });
                throw new Error(errorMessage);
            }
        } else {
            const unknownType = (message as { type?: unknown }).type;
            console.warn(`Unknown SQS message type: ${JSON.stringify(unknownType)}. messageId=${record.messageId}`);
        }
    }
};
