import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAITextRefinerService } from "./openAIService";
import type { ISecretProvider } from "../interfaces/ISecretProvider";
import type { HttpClient } from "../utils/http";

const API_KEY = "sk-test-key";

function makeSecretProvider(apiKey = API_KEY): ISecretProvider {
    return {
        getPrivateKeyPem: vi.fn().mockResolvedValue("pem"),
        getOpenAiApiKey: vi.fn().mockResolvedValue(apiKey),
    };
}

function makeHttpClient(returnValue: unknown = {}): HttpClient {
    return vi.fn().mockResolvedValue(returnValue);
}

describe("OpenAITextRefinerService", () => {
    let mockHttp: HttpClient;

    beforeEach(() => {
        mockHttp = makeHttpClient();
    });

    it("returns refined text from OpenAI response", async () => {
        mockHttp = makeHttpClient({ choices: [{ message: { content: "refined text" } }] });

        const provider = makeSecretProvider();
        const service = new OpenAITextRefinerService(provider, "gpt-4o-mini", "clean up the text", mockHttp);
        const result = await service.refine("raw voice input");

        expect(result).toBe("refined text");
        expect(provider.getOpenAiApiKey).toHaveBeenCalledOnce();
    });

    it("sends correct request to OpenAI API", async () => {
        mockHttp = makeHttpClient({ choices: [{ message: { content: "result" } }] });

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "system prompt", mockHttp);
        await service.refine("user input");

        expect(mockHttp).toHaveBeenCalledWith(
            "https://api.openai.com/v1/chat/completions",
            expect.objectContaining({
                method: "POST",
                token: API_KEY,
                body: {
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "system prompt" },
                        { role: "user", content: "user input" },
                    ],
                },
            }),
        );
    });

    it("throws when httpClient rejects (e.g. non-ok response)", async () => {
        mockHttp = vi.fn().mockRejectedValue(new Error("OpenAI API error: 429 Too Many Requests"));

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "prompt", mockHttp);
        await expect(service.refine("text")).rejects.toThrow("OpenAI API error: 429 Too Many Requests");
    });

    it("throws when httpClient rejects with timeout error", async () => {
        const timeoutError = new Error("OpenAI API request timed out after 10000ms");
        mockHttp = vi.fn().mockRejectedValue(timeoutError);

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "prompt", mockHttp);
        await expect(service.refine("text")).rejects.toThrow(/timed out/);
    });

    it("throws when OpenAI API returns empty content", async () => {
        mockHttp = makeHttpClient({ choices: [] });

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "prompt", mockHttp);
        await expect(service.refine("text")).rejects.toThrow("OpenAI API returned no choices");
    });

    it("uses default model and prompt when not specified", async () => {
        mockHttp = makeHttpClient({ choices: [{ message: { content: "result" } }] });

        const service = new OpenAITextRefinerService(makeSecretProvider(), undefined, undefined, mockHttp);
        await service.refine("text");

        expect(mockHttp).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                body: expect.objectContaining({ model: "gpt-4o-mini" }),
            }),
        );
    });
});
