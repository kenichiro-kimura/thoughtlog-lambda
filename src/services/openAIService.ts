import type { HttpClient } from "../utils/http";
import { openAIRequest } from "../utils/http";
import type { ISecretProvider } from "../interfaces/ISecretProvider";
import type { ITextRefinerService } from "../interfaces/ITextRefinerService";

export type { ITextRefinerService };

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SYSTEM_PROMPT = "与えられた音声テキストを清書してください。意味を変えずに、読みやすく整形してください。";

interface OpenAIChatResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

/** Refines text using the OpenAI Chat Completions API. */
export class OpenAITextRefinerService implements ITextRefinerService {
    constructor(
        private readonly secretProvider: ISecretProvider,
        private readonly model: string = DEFAULT_MODEL,
        private readonly systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
        private readonly httpClient: HttpClient = openAIRequest,
    ) {}

    async refine(text: string): Promise<string> {
        const apiKey = await this.secretProvider.getOpenAiApiKey();

        const data = await this.httpClient("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            token: apiKey,
            body: {
                model: this.model,
                messages: [
                    { role: "system", content: this.systemPrompt },
                    { role: "user", content: text },
                ],
            },
        }) as OpenAIChatResponse;

        if (!data.choices || data.choices.length === 0) {
            throw new Error("OpenAI API returned no choices");
        }
        const content = data.choices[0].message?.content;
        if (!content) {
            throw new Error("OpenAI API returned empty content");
        }
        return content;
    }
}
