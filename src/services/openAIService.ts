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
        private readonly fetchFn: typeof fetch = fetch,
    ) {}

    async refine(text: string): Promise<string> {
        const apiKey = await this.secretProvider.getOpenAiApiKey();

        // タイムアウト付きで OpenAI API を呼び出す
        const OPENAI_TIMEOUT_MS = 10_000; // 必要に応じて調整
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, OPENAI_TIMEOUT_MS);

        let response: Response;
        try {
            response = await this.fetchFn("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: "system", content: this.systemPrompt },
                        { role: "user", content: text },
                    ],
                }),
                signal: controller.signal,
            });
        } catch (error) {
            // AbortError をタイムアウトエラーとして扱う
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`OpenAI API request timed out after ${OPENAI_TIMEOUT_MS}ms`, { cause: error });
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            let errorBodySnippet = "";
            try {
                const rawBody = await response.text();
                const MAX_ERROR_BODY_LENGTH = 1000;
                if (rawBody) {
                    errorBodySnippet =
                        rawBody.length > MAX_ERROR_BODY_LENGTH
                            ? `${rawBody.slice(0, MAX_ERROR_BODY_LENGTH)}...[truncated]`
                            : rawBody;
                }
            } catch {
                // レスポンス本文が読めない場合は本文なしでエラーを返す
            }

            const messageBase = `OpenAI API error: ${response.status} ${response.statusText}`;
            const message =
                errorBodySnippet !== ""
                    ? `${messageBase} - Body: ${errorBodySnippet}`
                    : messageBase;

            throw new Error(message);
        }

        const data = await response.json() as OpenAIChatResponse;
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
